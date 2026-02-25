#!/usr/bin/env npx tsx
// scripts/update-models.ts — Fetch current free models from NIM & OpenRouter,
// diff against hardcoded NIM_MODELS list and model-rankings.json, and report changes.
//
// Usage:  npx tsx scripts/update-models.ts [--apply]
//   (no flag)   Dry-run — prints diff report only
//   --apply     Writes updated model-rankings.json (NIM_MODELS still needs manual edit)

import https from 'node:https';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const RANKINGS_PATH = join(ROOT, 'model-rankings.json');
const MODELS_TS_PATH = join(ROOT, 'src', 'lib', 'models.ts');
const APPLY = process.argv.includes('--apply');

// ─── HTTPS JSON fetcher ──────────────────────────────────────────────────────

function fetchJson(hostname: string, path: string, apiKey?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'User-Agent': 'frouter-updater/1.0' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const req = https.request({ hostname, port: 443, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`Failed to parse JSON from ${hostname}${path}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20_000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ─── Load config for API key ─────────────────────────────────────────────────

function loadApiKey(provider: string): string | null {
  const envVars: Record<string, string> = { nvidia: 'NVIDIA_API_KEY', openrouter: 'OPENROUTER_API_KEY' };
  const envKey = process.env[envVars[provider] || ''];
  if (envKey) return envKey;

  try {
    const configPath = join(process.env.HOME || '', '.frouter.json');
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    return cfg.apiKeys?.[provider] || null;
  } catch {
    return null;
  }
}

// ─── Non-chat model filter ───────────────────────────────────────────────────

const NON_CHAT_KEYWORDS = [
  'embed', 'rerank', 'reward', 'parse', 'clip', 'safety', 'guard',
  'content-safety', 'nemoguard', 'vila', 'neva', 'streampetr', 'deplot',
  'kosmos', 'paligemma', 'shieldgemma', 'recurrentgemma', 'starcoder',
  'fuyu', 'riva-translate', 'llama-guard', 'bge-m3', 'nvclip',
  'nemoretriever', 'nemotron-content-safety',
];

// Base models (not instruct/chat variants)
const BASE_MODEL_PATTERNS = [
  /\/gemma-2b$/,
  /\/gemma-7b$/,
  /\/codegemma-7b$/,
  /\/mixtral-8x22b-v0\.1$/,
  /minitron-8b-base$/,
];

function isNonChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  if (NON_CHAT_KEYWORDS.some(kw => lower.includes(kw))) return true;
  if (BASE_MODEL_PATTERNS.some(p => p.test(id))) return true;
  return false;
}

// ─── Extract hardcoded NIM model IDs from models.ts ──────────────────────────

function extractHardcodedNimIds(): Set<string> {
  const src = readFileSync(MODELS_TS_PATH, 'utf8');
  const ids = new Set<string>();
  const re = /makeModel\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    // Only count models with 'nvidia' providerKey (4th arg)
    const line = src.substring(m.index, src.indexOf('\n', m.index));
    if (line.includes("'nvidia'")) {
      ids.add(m[1]);
    }
  }
  return ids;
}

// ─── Tier assignment from SWE-bench score ────────────────────────────────────

function scoreTier(swe: number | null): string {
  if (swe == null) return '?';
  if (swe >= 70) return 'S+';
  if (swe >= 60) return 'S';
  if (swe >= 50) return 'A+';
  if (swe >= 40) return 'A';
  if (swe >= 35) return 'A-';
  if (swe >= 30) return 'B+';
  if (swe >= 20) return 'B';
  return 'C';
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('frouter model updater\n');

  // Load current rankings
  const rankings = JSON.parse(readFileSync(RANKINGS_PATH, 'utf8'));
  const rankingsById = new Map<string, any>();
  for (const m of rankings.models) {
    rankingsById.set(m.model_id, m);
    rankingsById.set(m.model_id.replace(':free', ''), m);
  }

  // ── Fetch NIM models ────────────────────────────────────────────────────────
  console.log('Fetching NIM models...');
  const nimKey = loadApiKey('nvidia');
  let nimApiModels: string[] = [];
  try {
    const nimData = await fetchJson('integrate.api.nvidia.com', '/v1/models', nimKey || undefined);
    const models = Array.isArray(nimData.data) ? nimData.data : [];
    nimApiModels = models
      .map((m: any) => m.id as string)
      .filter((id: string) => !isNonChatModel(id))
      .sort();
    console.log(`  Found ${nimApiModels.length} chat models on NIM API\n`);
  } catch (err: any) {
    console.error(`  Failed to fetch NIM: ${err.message}\n`);
  }

  // ── Fetch OpenRouter free models ────────────────────────────────────────────
  console.log('Fetching OpenRouter free models...');
  const orKey = loadApiKey('openrouter');
  let orApiModels: Array<{ id: string; name: string; context: number }> = [];
  try {
    const orData = await fetchJson('openrouter.ai', '/api/v1/models', orKey || undefined);
    const models = Array.isArray(orData.data) ? orData.data : [];
    orApiModels = models
      .filter((m: any) => m?.pricing?.prompt === '0' && m?.pricing?.completion === '0')
      .filter((m: any) => m.id !== 'openrouter/free') // meta-router, not a real model
      .map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        context: m.context_length || 32768,
      }))
      .sort((a: any, b: any) => a.id.localeCompare(b.id));
    console.log(`  Found ${orApiModels.length} free models on OpenRouter\n`);
  } catch (err: any) {
    console.error(`  Failed to fetch OpenRouter: ${err.message}\n`);
  }

  // ── NIM diff ────────────────────────────────────────────────────────────────
  const hardcoded = extractHardcodedNimIds();
  const nimApiSet = new Set(nimApiModels);

  const nimNew = nimApiModels.filter(id => !hardcoded.has(id));
  const nimRemoved = [...hardcoded].filter(id => !nimApiSet.has(id)).sort();

  console.log('═══ NIM DIFF ═══');
  if (nimNew.length) {
    console.log(`\n  NEW (${nimNew.length} models to add to NIM_MODELS):`);
    for (const id of nimNew) {
      const rank = rankingsById.get(id);
      const tier = rank?.tier || '?';
      console.log(`    + ${id}  [tier: ${tier}]`);
    }
  } else {
    console.log('\n  No new NIM models.');
  }

  if (nimRemoved.length) {
    console.log(`\n  REMOVED (${nimRemoved.length} models to remove from NIM_MODELS):`);
    for (const id of nimRemoved) {
      console.log(`    - ${id}`);
    }
  } else {
    console.log('  No removed NIM models.');
  }

  // ── OpenRouter diff ─────────────────────────────────────────────────────────
  const orRankingsIds = new Set(
    rankings.models.filter((m: any) => m.source === 'openrouter').map((m: any) => m.model_id)
  );
  const orApiIds = new Set(orApiModels.map(m => m.id));

  const orNew = orApiModels.filter(m => !orRankingsIds.has(m.id));
  const orRemoved = [...orRankingsIds].filter(id => !orApiIds.has(id)).sort();

  console.log('\n═══ OPENROUTER DIFF ═══');
  if (orNew.length) {
    console.log(`\n  NEW (${orNew.length} models to add to rankings):`);
    for (const m of orNew) {
      console.log(`    + ${m.id}  (${m.name})  ctx:${m.context}`);
    }
  } else {
    console.log('\n  No new OpenRouter free models.');
  }

  if (orRemoved.length) {
    console.log(`\n  REMOVED (${orRemoved.length} models no longer free):`);
    for (const id of orRemoved) {
      console.log(`    - ${id}`);
    }
  }

  // ── Missing rankings ───────────────────────────────────────────────────────
  const allIds = [...nimApiModels, ...orApiModels.map(m => m.id)];
  const missingRankings = allIds.filter(id => !rankingsById.has(id) && !rankingsById.has(id.replace(':free', '')));

  if (missingRankings.length) {
    console.log(`\n═══ MISSING RANKINGS (${missingRankings.length}) ═══`);
    console.log('  These models have no entry in model-rankings.json:');
    for (const id of missingRankings.sort()) {
      console.log(`    ? ${id}`);
    }
  }

  // ── Apply changes to rankings ──────────────────────────────────────────────
  if (APPLY) {
    console.log('\n═══ APPLYING CHANGES ═══');
    let changed = false;

    // Remove OpenRouter models no longer free
    const beforeLen = rankings.models.length;
    rankings.models = rankings.models.filter((m: any) => {
      if (m.source === 'openrouter' && orRemoved.includes(m.model_id)) {
        console.log(`  Removed from rankings: ${m.model_id}`);
        return false;
      }
      return true;
    });
    if (rankings.models.length !== beforeLen) changed = true;

    // Remove NIM models no longer on API
    const beforeLen2 = rankings.models.length;
    rankings.models = rankings.models.filter((m: any) => {
      if (m.source === 'nim' && nimRemoved.includes(m.model_id)) {
        console.log(`  Removed from rankings: ${m.model_id}`);
        return false;
      }
      return true;
    });
    if (rankings.models.length !== beforeLen2) changed = true;

    // Add new OpenRouter models with placeholder rankings
    for (const m of orNew) {
      const bare = m.id.replace(':free', '');
      // Check if a NIM twin exists in rankings
      const nimTwin = rankingsById.get(bare);
      const entry: any = {
        source: 'openrouter',
        model_id: m.id,
        name: m.name,
        swe_bench: nimTwin?.swe_bench || null,
        tier: nimTwin?.tier || '?',
        context: m.context >= 1000 ? `${Math.round(m.context / 1000)}k` : String(m.context),
      };
      if (nimTwin?.aa_slug) entry.aa_slug = nimTwin.aa_slug;
      if (nimTwin?.aa_intelligence != null) entry.aa_intelligence = nimTwin.aa_intelligence;
      if (nimTwin?.aa_speed_tps != null) entry.aa_speed_tps = nimTwin.aa_speed_tps;
      rankings.models.push(entry);
      console.log(`  Added to rankings: ${m.id} [tier: ${entry.tier}]`);
      changed = true;
    }

    if (changed) {
      writeFileSync(RANKINGS_PATH, JSON.stringify(rankings, null, 2) + '\n');
      console.log(`\n  ✓ Updated ${RANKINGS_PATH}`);
    } else {
      console.log('\n  No changes to apply.');
    }
  } else {
    console.log('\n(dry run — pass --apply to write changes)');
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n═══ SUMMARY ═══');
  console.log(`  NIM:        +${nimNew.length} new, -${nimRemoved.length} removed`);
  console.log(`  OpenRouter: +${orNew.length} new, -${orRemoved.length} removed`);
  console.log(`  Rankings:   ${missingRankings.length} models missing ranking data`);
  if (!APPLY && (nimNew.length || nimRemoved.length || orNew.length || orRemoved.length)) {
    console.log('\n  Next steps:');
    console.log('    1. Run with --apply to update model-rankings.json');
    console.log('    2. Manually update NIM_MODELS in src/lib/models.ts');
    console.log('    3. Add SWE-bench scores for new models from artificialanalysis.ai');
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
