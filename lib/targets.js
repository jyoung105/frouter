// lib/targets.js — write config to OpenCode and OpenClaw
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { PROVIDERS_META, validateProviderApiKey } from './config.js';

const OPENCODE_PATH = join(homedir(), '.config', 'opencode', 'opencode.json');
const OPENCLAW_PATH = join(homedir(), '.openclaw', 'openclaw.json');

function readJson(path) {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return {}; }
}

function backupAndWriteJson(path, data) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (existsSync(path)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(path, `${path}.backup-${ts}`);
  }
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}

function normalizeModelId(id) {
  return String(id || '').toLowerCase().replace(/:free$/i, '');
}

function getProviderMeta(providerKey) {
  const meta = PROVIDERS_META[providerKey];
  if (!meta) throw new Error(`Unknown provider "${providerKey}"`);
  return meta;
}

function resolvePersistedApiKey(providerKey, apiKey, options = {}) {
  if (!options.persistApiKey || !apiKey) return null;
  const checked = validateProviderApiKey(providerKey, apiKey);
  if (!checked.ok) {
    throw new Error(`Refusing to persist invalid ${providerKey} API key: ${checked.reason}`);
  }
  return checked.key;
}

// ─── Provider config blocks ───────────────────────────────────────────────────

function openCodeProviderBlock(providerKey, apiKey) {
  const meta = getProviderMeta(providerKey);
  const baseURL = meta.chatUrl.replace('/chat/completions', '');
  return {
    npm:     '@ai-sdk/openai-compatible',
    name:    meta.name,
    options: {
      baseURL,
      apiKey: apiKey || `{env:${meta.envVar}}`,
    },
  };
}

// ─── OpenCode ────────────────────────────────────────────────────────────────

/**
 * Merge frouter provider block into OpenCode config and set active model.
 * Preserves all existing keys (other providers, plugins, etc.).
 */
export function writeOpenCode(model, providerKey, apiKey = null, options = {}) {
  const persistedApiKey = resolvePersistedApiKey(providerKey, apiKey, options);
  const cfg = readJson(OPENCODE_PATH);
  if (!cfg.provider) cfg.provider = {};

  // Add/replace frouter's provider block
  cfg.provider[providerKey] = openCodeProviderBlock(providerKey, persistedApiKey);

  // Set active model: "providerKey/modelId"
  cfg.model = `${providerKey}/${model.id}`;

  backupAndWriteJson(OPENCODE_PATH, cfg);
  return OPENCODE_PATH;
}

/**
 * In Oh-My-OpenCode mode, many NVIDIA NIM models are not tool-call compatible.
 * If a free OpenRouter twin exists, prefer that twin for OpenCode only.
 */
export function resolveOpenCodeSelection(model, providerKey, allModels = []) {
  const cfg = readJson(OPENCODE_PATH);
  const hasOhMyOpenCode = Array.isArray(cfg.plugin)
    && cfg.plugin.some((p) => String(p).startsWith('oh-my-opencode'));

  if (!hasOhMyOpenCode || providerKey !== 'nvidia') {
    return { model, providerKey, fallback: false };
  }

  const wanted = normalizeModelId(model?.id);
  const twin = allModels.find((m) =>
    m?.providerKey === 'openrouter'
    && /:free$/i.test(String(m.id))
    && normalizeModelId(m.id) === wanted
  );

  if (!twin) return { model, providerKey, fallback: false };
  return {
    model: twin,
    providerKey: 'openrouter',
    fallback: true,
    reason: 'oh-my-opencode + nvidia compatibility',
  };
}

// ─── OpenClaw ────────────────────────────────────────────────────────────────

/**
 * Merge frouter config into OpenClaw JSON:
 *   - models.providers.<providerKey>
 *   - env.<PROVIDER>_API_KEY  (actual key value — OpenClaw's own design)
 *   - agents.defaults.model.primary
 *   - agents.defaults.models allowlist entry (required or OpenClaw rejects it)
 */
export function writeOpenClaw(model, providerKey, apiKey = null, options = {}) {
  const persistedApiKey = resolvePersistedApiKey(providerKey, apiKey, options);
  const meta = getProviderMeta(providerKey);
  const cfg  = readJson(OPENCLAW_PATH);
  const baseUrl = meta.chatUrl.replace('/chat/completions', '');

  // models.providers
  cfg.models ??= {};
  cfg.models.providers ??= {};
  cfg.models.providers[providerKey] = { baseUrl, api: 'openai-completions' };

  // env
  if (persistedApiKey) {
    cfg.env ??= {};
    cfg.env[meta.envVar] = persistedApiKey;
  } else if (cfg.env?.[meta.envVar]) {
    delete cfg.env[meta.envVar];
    if (Object.keys(cfg.env).length === 0) delete cfg.env;
  }

  // qualified model id
  const qid = `${providerKey}/${model.id}`;

  // agents.defaults
  cfg.agents ??= {};
  cfg.agents.defaults ??= {};
  cfg.agents.defaults.model ??= {};
  cfg.agents.defaults.model.primary = qid;
  cfg.agents.defaults.models ??= {};
  cfg.agents.defaults.models[qid] = {};

  backupAndWriteJson(OPENCLAW_PATH, cfg);
  return OPENCLAW_PATH;
}
