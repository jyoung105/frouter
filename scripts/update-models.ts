#!/usr/bin/env npx tsx
// scripts/update-models.ts — Sync free model catalogs (NIM + OpenRouter),
// OpenCode-supported model IDs (models.dev), and AI metadata (Artificial Analysis).
//
// Usage:
//   npx tsx scripts/update-models.ts [--apply] [--report <path>] [--fail-on-unresolved-tier]
//
// Flags:
//   --apply                     Write updated files (model-rankings.json, model-support.json)
//   --report <path>             Write machine-readable sync report JSON
//   --fail-on-unresolved-tier   Exit non-zero when new models still have tier "?"

import https from "node:https";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const RANKINGS_PATH = join(ROOT, "model-rankings.json");
const SUPPORT_PATH = join(ROOT, "model-support.json");
const MODELS_TS_PATH = join(ROOT, "src", "lib", "models.ts");

const APPLY = process.argv.includes("--apply");
const FAIL_ON_UNRESOLVED_TIER = process.argv.includes(
  "--fail-on-unresolved-tier",
);
const REPORT_PATH = readFlagValue("--report");

const AA_ENDPOINTS = ["/api/v2/models", "/api/v1/models", "/api/models"];

type ProviderKey = "nvidia" | "openrouter";

type CatalogModel = {
  id: string;
  name: string;
  context: number;
};

type AAMeta = {
  swe_bench: string | null;
  aa_slug: string;
  aa_intelligence: number | null;
  aa_speed_tps: number | null;
  aa_price_input: number | null;
  aa_price_output: number | null;
  aa_context: string;
  aa_url: string;
  tier: string | null;
};

type Report = {
  generated_at: string;
  apply: boolean;
  providers: {
    nim: {
      fetched: boolean;
      total: number;
      new_hardcoded: number;
      removed_hardcoded: number;
      added_rankings: number;
      removed_rankings: number;
    };
    openrouter: {
      fetched: boolean;
      total: number;
      new_rankings: number;
      removed_rankings: number;
      added_rankings: number;
      removed_rankings_applied: number;
    };
    opencode: {
      fetched: boolean;
      nvidia_supported: number;
      openrouter_supported: number;
    };
    artificial_analysis: {
      fetched: boolean;
      endpoint: string | null;
      entries: number;
    };
  };
  rankings: {
    missing_rankings: number;
    unresolved_tier_models: string[];
    changed: boolean;
  };
};

// ─── CLI args ────────────────────────────────────────────────────────────────

function readFlagValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0) return process.argv[idx + 1] || null;

  const prefix = `${flag}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : null;
}

// ─── HTTPS JSON fetcher ──────────────────────────────────────────────────────

function fetchJson(
  hostname: string,
  path: string,
  options: {
    apiKey?: string | null;
    headers?: Record<string, string>;
    raw?: boolean;
  } = {},
): Promise<any> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "User-Agent": "frouter-updater/2.0",
      Accept: options.raw ? "text/plain" : "application/json",
      ...(options.headers || {}),
    };
    if (options.apiKey) headers["Authorization"] = `Bearer ${options.apiKey}`;

    const req = https.request(
      { hostname, port: 443, path, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => {
          if (options.raw) {
            resolve(body);
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Failed to parse JSON from ${hostname}${path}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(20_000, () => {
      req.destroy();
      reject(new Error(`Timeout: ${hostname}${path}`));
    });
    req.end();
  });
}

// ─── Config helpers ──────────────────────────────────────────────────────────

function loadApiKey(provider: string): string | null {
  const envVars: Record<string, string> = {
    nvidia: "NVIDIA_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    artificialanalysis: "ARTIFICIAL_ANALYSIS_API_KEY",
  };

  const envKey = process.env[envVars[provider] || ""];
  if (envKey) return envKey;

  try {
    const configPath = join(process.env.HOME || "", ".frouter.json");
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    return cfg.apiKeys?.[provider] || null;
  } catch {
    return null;
  }
}

// ─── Model ID normalization ──────────────────────────────────────────────────

function stripProviderPrefix(id: string): string {
  return id.replace(/^(openrouter|nvidia|nim)\//i, "");
}

function stripFreeSuffix(id: string): string {
  return id.replace(/:free$/i, "");
}

function normalizeModelId(id: string): string {
  return stripFreeSuffix(stripProviderPrefix(id.trim()));
}

function toSlugKey(id: string): string {
  return (
    normalizeModelId(id)
      .split("/")
      .pop()
      ?.toLowerCase()
      .replace(/[._]/g, "-")
      .replace(
        /-(instruct|it|fp8|preview|turbo|versatile|2507|2512|2506|v\d+[\d.]*|a\d+b).*$/,
        "",
      )
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || ""
  );
}

function normalizeSearchKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/https?:\/\/artificialanalysis\.ai\/models\//, "")
    .replace(/[^a-z0-9/:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleFromModelId(id: string): string {
  return (
    id
      .split("/")
      .pop()
      ?.replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) || id
  );
}

function formatContext(context: number | null | undefined): string {
  if (!context || !Number.isFinite(context) || context <= 0) return "";
  if (context >= 1_000_000) {
    const m = context / 1_000_000;
    return Number.isInteger(m) ? `${m}m` : `${m.toFixed(1)}m`;
  }
  if (context >= 1000) return `${Math.round(context / 1000)}k`;
  return String(context);
}

// ─── Tier helpers ────────────────────────────────────────────────────────────

function scoreTierFromSwe(swe: number | null): string {
  if (swe == null) return "?";
  if (swe >= 70) return "S+";
  if (swe >= 60) return "S";
  if (swe >= 50) return "A+";
  if (swe >= 40) return "A";
  if (swe >= 35) return "A-";
  if (swe >= 30) return "B+";
  if (swe >= 20) return "B";
  return "C";
}

function scoreTierFromIntelligence(score: number | null): string {
  if (score == null) return "?";
  if (score >= 45) return "S+";
  if (score >= 35) return "S";
  if (score >= 28) return "A+";
  if (score >= 20) return "A";
  if (score >= 15) return "A-";
  if (score >= 12) return "B+";
  if (score >= 8) return "B";
  return "C";
}

function parsePercentToNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") {
    const value = Number.parseFloat(input.replace("%", "").trim());
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function parseNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeTier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.toUpperCase().trim();
  return ["S+", "S", "A+", "A", "A-", "B+", "B", "C"].includes(v) ? v : null;
}

function deriveTier(meta: AAMeta | null, fallbackSwe: string | null): string {
  if (meta?.tier) return meta.tier;

  const sweNum = parsePercentToNumber(meta?.swe_bench ?? fallbackSwe);
  const bySwe = scoreTierFromSwe(sweNum);
  if (bySwe !== "?") return bySwe;

  const byIq = scoreTierFromIntelligence(meta?.aa_intelligence ?? null);
  return byIq;
}

// ─── NIM helper filters ──────────────────────────────────────────────────────

const NON_CHAT_KEYWORDS = [
  "embed",
  "rerank",
  "reward",
  "parse",
  "clip",
  "safety",
  "guard",
  "content-safety",
  "nemoguard",
  "vila",
  "neva",
  "streampetr",
  "deplot",
  "kosmos",
  "paligemma",
  "shieldgemma",
  "recurrentgemma",
  "starcoder",
  "fuyu",
  "riva-translate",
  "llama-guard",
  "bge-m3",
  "nvclip",
  "nemoretriever",
  "nemotron-content-safety",
];

const BASE_MODEL_PATTERNS = [
  /\/gemma-2b$/,
  /\/gemma-7b$/,
  /\/codegemma-7b$/,
  /\/mixtral-8x22b-v0\.1$/,
  /minitron-8b-base$/,
];

function isNonChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  if (NON_CHAT_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  if (BASE_MODEL_PATTERNS.some((p) => p.test(id))) return true;
  return false;
}

// ─── Parse hardcoded NIM list from src/lib/models.ts ────────────────────────

function extractHardcodedNimIds(): Set<string> {
  const src = readFileSync(MODELS_TS_PATH, "utf8");
  const ids = new Set<string>();

  const re =
    /makeModel\(\s*["']([^"']+)["'][\s\S]*?["'](nvidia|openrouter)["'],?\s*\)/g;

  let m: RegExpExecArray | null = null;
  while ((m = re.exec(src)) !== null) {
    if (m[2] === "nvidia") ids.add(m[1]);
  }

  return ids;
}

// ─── OpenCode support (models.dev) ───────────────────────────────────────────

function emptySupportSets() {
  return {
    nvidia: new Set<string>(),
    openrouter: new Set<string>(),
  };
}

function parseProviderHint(value: unknown): ProviderKey | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase().trim();
  if (v === "nvidia" || v === "nim") return "nvidia";
  if (v === "openrouter") return "openrouter";
  return null;
}

function looksLikeModelId(value: string): boolean {
  return (
    /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(value) &&
    !/^https?:\/\//i.test(value)
  );
}

function addSupportId(
  target: ReturnType<typeof emptySupportSets>,
  provider: ProviderKey,
  modelId: string,
) {
  const bare = stripProviderPrefix(modelId.trim());
  if (!looksLikeModelId(bare)) return;
  target[provider].add(bare);
  target[provider].add(stripFreeSuffix(bare));
}

function parseOpenCodeSupport(raw: any) {
  const out = emptySupportSets();

  function visit(node: any, providerHint: ProviderKey | null, depth: number) {
    if (depth > 10 || node == null) return;

    if (typeof node === "string") {
      const text = node.trim();

      if (text.startsWith("openrouter/")) {
        addSupportId(out, "openrouter", text.slice("openrouter/".length));
        return;
      }
      if (text.startsWith("nvidia/")) {
        addSupportId(out, "nvidia", text.slice("nvidia/".length));
        return;
      }
      if (text.startsWith("nim/")) {
        addSupportId(out, "nvidia", text.slice("nim/".length));
        return;
      }

      if (providerHint && looksLikeModelId(text)) {
        addSupportId(out, providerHint, text);
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item, providerHint, depth + 1);
      return;
    }

    if (typeof node === "object") {
      let inheritedHint = providerHint;

      if (typeof node.provider === "string") {
        inheritedHint = parseProviderHint(node.provider) ?? inheritedHint;
      }

      for (const [key, value] of Object.entries(node)) {
        const keyHint = parseProviderHint(key) ?? inheritedHint;
        visit(value, keyHint, depth + 1);
      }
    }
  }

  visit(raw, null, 0);
  return out;
}

/** Parse OpenCode Go source (openrouter.go) to extract hardcoded model IDs.
 *  OpenCode has NO built-in nvidia/NIM provider — only OpenRouter models. */
function parseOpenCodeGoSource(goSource: string) {
  const out = emptySupportSets();
  // Match APIModel: "vendor/model-id" patterns in Go source
  const re = /APIModel:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(goSource)) !== null) {
    addSupportId(out, "openrouter", match[1]);
  }
  return out;
}

function loadExistingSupportFile() {
  const out = emptySupportSets();
  if (!existsSync(SUPPORT_PATH)) return out;

  try {
    const parsed = JSON.parse(readFileSync(SUPPORT_PATH, "utf8"));
    for (const id of parsed?.providers?.nvidia || [])
      addSupportId(out, "nvidia", id);
    for (const id of parsed?.providers?.openrouter || [])
      addSupportId(out, "openrouter", id);
  } catch {
    /* ignore malformed support file */
  }

  return out;
}

function hasSupportData(support: ReturnType<typeof emptySupportSets>): boolean {
  return support.nvidia.size > 0 || support.openrouter.size > 0;
}

function isOpenCodeSupported(
  provider: ProviderKey,
  modelId: string,
  support: ReturnType<typeof emptySupportSets>,
): boolean | null {
  const set = support[provider];
  if (!set || set.size === 0) return null;

  const bare = stripProviderPrefix(modelId);
  const noFree = stripFreeSuffix(bare);
  const candidates = new Set([bare, noFree, `${noFree}:free`]);

  for (const c of candidates) {
    if (set.has(c)) return true;
  }
  return false;
}

function writeSupportFile(
  support: ReturnType<typeof emptySupportSets>,
  fetchedFromGithub: boolean,
) {
  const next = {
    source: fetchedFromGithub
      ? "https://github.com/opencode-ai/opencode/blob/main/internal/llm/models/"
      : "https://models.dev/api.json",
    updated_at: new Date().toISOString(),
    note: "OpenCode has NO built-in nvidia/NIM provider. OpenRouter has ~20 hardcoded models.",
    providers: {
      nvidia: [...support.nvidia].sort((a, b) => a.localeCompare(b)),
      openrouter: [...support.openrouter].sort((a, b) => a.localeCompare(b)),
    },
  };
  writeFileSync(SUPPORT_PATH, JSON.stringify(next, null, 2) + "\n");
}

// ─── Artificial Analysis matching ────────────────────────────────────────────

function listFromAnyPayload(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];

  for (const key of ["models", "data", "results", "items"]) {
    if (Array.isArray(raw[key])) return raw[key];
    if (Array.isArray(raw[key]?.models)) return raw[key].models;
    if (Array.isArray(raw[key]?.data)) return raw[key].data;
  }

  return [];
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function toAAMeta(row: any): AAMeta | null {
  const slug = firstString(row?.aa_slug, row?.slug, row?.model_slug, row?.id);
  const sweRawValue =
    row?.swe_bench ??
    row?.sweBench ??
    row?.swe_bench_verified ??
    row?.sweBenchVerified;
  const sweNum = parsePercentToNumber(sweRawValue);
  const swe = sweNum == null ? null : `${sweNum}%`;

  const tier = normalizeTier(row?.tier);
  const aa_url =
    firstString(row?.aa_url, row?.url, row?.model_url) ||
    (slug ? `https://artificialanalysis.ai/models/${slug}` : "");

  const meta: AAMeta = {
    swe_bench: swe,
    aa_slug: slug,
    aa_intelligence: parseNumberOrNull(
      row?.aa_intelligence ?? row?.intelligence_index ?? row?.intelligence,
    ),
    aa_speed_tps: parseNumberOrNull(row?.aa_speed_tps ?? row?.speed_tps),
    aa_price_input: parseNumberOrNull(
      row?.aa_price_input ?? row?.price_input ?? row?.input_price,
    ),
    aa_price_output: parseNumberOrNull(
      row?.aa_price_output ?? row?.price_output ?? row?.output_price,
    ),
    aa_context: firstString(row?.aa_context, row?.context, row?.context_window),
    aa_url,
    tier,
  };

  if (
    !meta.aa_slug &&
    meta.swe_bench == null &&
    meta.aa_intelligence == null &&
    meta.aa_speed_tps == null
  ) {
    return null;
  }

  return meta;
}

function indexAAModels(rows: any[]) {
  const lookup = new Map<string, AAMeta>();

  function setIfAbsent(key: string, value: AAMeta) {
    const normalized = normalizeSearchKey(key);
    if (!normalized || lookup.has(normalized)) return;
    lookup.set(normalized, value);
  }

  for (const row of rows) {
    const meta = toAAMeta(row);
    if (!meta) continue;

    const modelId = firstString(row?.model_id, row?.modelId, row?.id);
    const modelName = firstString(row?.name, row?.model_name, row?.title);

    if (modelId) {
      const bare = normalizeModelId(modelId);
      setIfAbsent(bare, meta);
      setIfAbsent(toSlugKey(bare), meta);
    }

    if (meta.aa_slug) {
      setIfAbsent(meta.aa_slug, meta);
    }

    if (modelName) {
      setIfAbsent(modelName.replace(/\s+/g, "-"), meta);
    }
  }

  return lookup;
}

function findAAMeta(
  modelId: string,
  modelName: string,
  aaLookup: Map<string, AAMeta>,
): AAMeta | null {
  const bare = normalizeModelId(modelId);
  const candidates = [
    bare,
    toSlugKey(bare),
    modelName.replace(/\s+/g, "-"),
    modelName,
    bare.split("/").pop() || "",
  ];

  for (const key of candidates) {
    const hit = aaLookup.get(normalizeSearchKey(key));
    if (hit) return hit;
  }

  return null;
}

function mergeAAMeta(target: any, meta: AAMeta | null): boolean {
  if (!meta) return false;

  let changed = false;

  const updates: Record<string, any> = {
    swe_bench: meta.swe_bench,
    aa_slug: meta.aa_slug,
    aa_intelligence: meta.aa_intelligence,
    aa_speed_tps: meta.aa_speed_tps,
    aa_price_input: meta.aa_price_input,
    aa_price_output: meta.aa_price_output,
    aa_context: meta.aa_context,
    aa_url: meta.aa_url,
  };

  for (const [key, value] of Object.entries(updates)) {
    if (value == null || value === "") continue;
    if (target[key] !== value) {
      target[key] = value;
      changed = true;
    }
  }

  const nextTier = deriveTier(meta, target.swe_bench || null);
  if (nextTier !== "?" && target.tier !== nextTier) {
    target.tier = nextTier;
    changed = true;
  }

  return changed;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("frouter model updater\n");

  const report: Report = {
    generated_at: new Date().toISOString(),
    apply: APPLY,
    providers: {
      nim: {
        fetched: false,
        total: 0,
        new_hardcoded: 0,
        removed_hardcoded: 0,
        added_rankings: 0,
        removed_rankings: 0,
      },
      openrouter: {
        fetched: false,
        total: 0,
        new_rankings: 0,
        removed_rankings: 0,
        added_rankings: 0,
        removed_rankings_applied: 0,
      },
      opencode: {
        fetched: false,
        nvidia_supported: 0,
        openrouter_supported: 0,
      },
      artificial_analysis: {
        fetched: false,
        endpoint: null,
        entries: 0,
      },
    },
    rankings: {
      missing_rankings: 0,
      unresolved_tier_models: [],
      changed: false,
    },
  };

  const rankings = JSON.parse(readFileSync(RANKINGS_PATH, "utf8"));

  const rankingsById = new Map<string, any>();
  for (const model of rankings.models) {
    rankingsById.set(model.model_id, model);
    rankingsById.set(normalizeModelId(model.model_id), model);
  }

  // ── Artificial Analysis fetch ──────────────────────────────────────────────
  console.log("Fetching Artificial Analysis model data...");
  const aaKey = loadApiKey("artificialanalysis");
  let aaLookup = new Map<string, AAMeta>();

  for (const endpoint of AA_ENDPOINTS) {
    try {
      const data = await fetchJson("artificialanalysis.ai", endpoint, {
        apiKey: aaKey || undefined,
        headers: aaKey ? { "x-api-key": aaKey } : {},
      });
      aaLookup = indexAAModels(listFromAnyPayload(data));
      if (aaLookup.size > 0) {
        report.providers.artificial_analysis = {
          fetched: true,
          endpoint,
          entries: aaLookup.size,
        };
        console.log(
          `  Found ${aaLookup.size} indexed entries from AA (${endpoint})\n`,
        );
        break;
      }
    } catch {
      // try next endpoint
    }
  }

  if (!report.providers.artificial_analysis.fetched) {
    console.log(
      "  AA fetch unavailable; continuing with existing ranking metadata\n",
    );
  }

  // ── OpenCode support fetch (from OpenCode GitHub source) ─────────────────
  // OpenCode has NO built-in nvidia/NIM provider.
  // Only 20 hardcoded OpenRouter models exist in the source.
  // Source: https://github.com/opencode-ai/opencode/blob/main/internal/llm/models/openrouter.go
  console.log("Fetching OpenCode-supported models (OpenCode GitHub source)...");
  let support = loadExistingSupportFile();
  let supportFetched = false;
  let supportFromGithub = false;

  try {
    const goSource = await fetchJson(
      "raw.githubusercontent.com",
      "/opencode-ai/opencode/main/internal/llm/models/openrouter.go",
      { raw: true },
    );

    if (typeof goSource === "string" && goSource.includes("APIModel")) {
      const parsed = parseOpenCodeGoSource(goSource);
      if (hasSupportData(parsed)) {
        support = parsed;
        supportFetched = true;
        supportFromGithub = true;
      }
    }

    if (!supportFetched) {
      // Fallback: try models.dev (broader AI SDK registry, less accurate)
      const modelsDev = await fetchJson("models.dev", "/api.json");
      const parsed = parseOpenCodeSupport(modelsDev);
      if (hasSupportData(parsed)) {
        support = parsed;
        supportFetched = true;
        console.log(
          "  (used models.dev fallback — may include non-OpenCode models)",
        );
      }
    }

    console.log(
      `  Found support IDs: nvidia=${support.nvidia.size}, openrouter=${support.openrouter.size}\n`,
    );
  } catch (err: any) {
    console.log(`  Failed to fetch OpenCode source: ${err.message}`);
    console.log(
      "  Falling back to existing model-support.json (if present).\n",
    );
  }

  report.providers.opencode = {
    fetched: supportFetched,
    nvidia_supported: support.nvidia.size,
    openrouter_supported: support.openrouter.size,
  };

  // ── Fetch NIM models ───────────────────────────────────────────────────────
  console.log("Fetching NIM models...");
  const nimKey = loadApiKey("nvidia");
  let nimApiModels: CatalogModel[] = [];
  let nimFetchOk = false;

  try {
    const nimData = await fetchJson("integrate.api.nvidia.com", "/v1/models", {
      apiKey: nimKey || undefined,
    });

    const models = Array.isArray(nimData.data) ? nimData.data : [];
    nimApiModels = models
      .map((m: any) => ({
        id: m.id as string,
        name: titleFromModelId(m.id as string),
        context: Number(m.context_length) || 32768,
      }))
      .filter((m: CatalogModel) => !isNonChatModel(m.id))
      .sort((a: CatalogModel, b: CatalogModel) => a.id.localeCompare(b.id));

    nimFetchOk = true;
    report.providers.nim.fetched = true;
    report.providers.nim.total = nimApiModels.length;
    console.log(`  Found ${nimApiModels.length} chat models on NIM API\n`);
  } catch (err: any) {
    console.error(`  Failed to fetch NIM: ${err.message}\n`);
  }

  // ── Fetch OpenRouter free + tools models ──────────────────────────────────
  console.log("Fetching OpenRouter free tool-capable models...");
  const orKey = loadApiKey("openrouter");
  let orApiModels: CatalogModel[] = [];
  let orFetchOk = false;

  try {
    const orData = await fetchJson("openrouter.ai", "/api/v1/models", {
      apiKey: orKey || undefined,
    });

    const models = Array.isArray(orData.data) ? orData.data : [];
    orApiModels = models
      .filter(
        (m: any) =>
          m?.pricing?.prompt === "0" &&
          m?.pricing?.completion === "0" &&
          Array.isArray(m?.supported_parameters) &&
          m.supported_parameters.includes("tools"),
      )
      .filter((m: any) => m.id !== "openrouter/free")
      .map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        context: Number(m.context_length) || 32768,
      }))
      .sort((a: CatalogModel, b: CatalogModel) => a.id.localeCompare(b.id));

    orFetchOk = true;
    report.providers.openrouter.fetched = true;
    report.providers.openrouter.total = orApiModels.length;
    console.log(`  Found ${orApiModels.length} OpenRouter free tool models\n`);
  } catch (err: any) {
    console.error(`  Failed to fetch OpenRouter: ${err.message}\n`);
  }

  // ── Diffs ───────────────────────────────────────────────────────────────────
  const hardcoded = extractHardcodedNimIds();
  const nimApiSet = new Set(nimApiModels.map((m) => m.id));

  const nimNew = nimFetchOk
    ? nimApiModels.map((m) => m.id).filter((id) => !hardcoded.has(id))
    : [];
  const nimRemoved = nimFetchOk
    ? [...hardcoded].filter((id) => !nimApiSet.has(id)).sort()
    : [];

  report.providers.nim.new_hardcoded = nimNew.length;
  report.providers.nim.removed_hardcoded = nimRemoved.length;

  console.log("═══ NIM DIFF ═══");
  if (!nimFetchOk) {
    console.log("  Skipped (NIM fetch failed).");
  } else {
    if (nimNew.length) {
      console.log(`\n  NEW (${nimNew.length} models to add to NIM_MODELS):`);
      for (const id of nimNew) {
        const rank = rankingsById.get(normalizeModelId(id));
        const tier = rank?.tier || "?";
        console.log(`    + ${id}  [tier: ${tier}]`);
      }
    } else {
      console.log("\n  No new NIM models.");
    }

    if (nimRemoved.length) {
      console.log(
        `\n  REMOVED (${nimRemoved.length} models to remove from NIM_MODELS):`,
      );
      for (const id of nimRemoved) console.log(`    - ${id}`);
    } else {
      console.log("  No removed NIM models.");
    }
  }

  const orRankingsIds = new Set<string>(
    rankings.models
      .filter((m: any) => m.source === "openrouter")
      .map((m: any) => m.model_id),
  );
  const orApiIds = new Set(orApiModels.map((m) => m.id));

  const orNew = orFetchOk
    ? orApiModels.filter((m) => !orRankingsIds.has(m.id))
    : [];
  const orRemoved = orFetchOk
    ? [...orRankingsIds].filter((id) => !orApiIds.has(id)).sort()
    : [];

  report.providers.openrouter.new_rankings = orNew.length;
  report.providers.openrouter.removed_rankings = orRemoved.length;

  console.log("\n═══ OPENROUTER DIFF ═══");
  if (!orFetchOk) {
    console.log("  Skipped (OpenRouter fetch failed).");
  } else {
    if (orNew.length) {
      console.log(`\n  NEW (${orNew.length} models to add to rankings):`);
      for (const m of orNew) {
        console.log(`    + ${m.id}  (${m.name})  ctx:${m.context}`);
      }
    } else {
      console.log("\n  No new OpenRouter free models.");
    }

    if (orRemoved.length) {
      console.log(`\n  REMOVED (${orRemoved.length} models no longer free):`);
      for (const id of orRemoved) console.log(`    - ${id}`);
    }
  }

  const allFetchedIds = [
    ...(nimFetchOk ? nimApiModels.map((m) => m.id) : []),
    ...(orFetchOk ? orApiModels.map((m) => m.id) : []),
  ];

  const missingRankings = allFetchedIds.filter((id) => {
    const key = normalizeModelId(id);
    return !rankingsById.has(id) && !rankingsById.has(key);
  });

  report.rankings.missing_rankings = missingRankings.length;

  if (missingRankings.length) {
    console.log(`\n═══ MISSING RANKINGS (${missingRankings.length}) ═══`);
    console.log("  These models have no entry in model-rankings.json:");
    for (const id of missingRankings.sort()) console.log(`    ? ${id}`);
  }

  // ── Apply changes ──────────────────────────────────────────────────────────
  let changed = false;
  const unresolvedTierModels: string[] = [];

  if (APPLY) {
    console.log("\n═══ APPLYING CHANGES ═══");

    // Remove stale OpenRouter entries only when OpenRouter fetch succeeded.
    if (orFetchOk && orRemoved.length > 0) {
      const beforeLen = rankings.models.length;
      rankings.models = rankings.models.filter((m: any) => {
        if (m.source === "openrouter" && orRemoved.includes(m.model_id)) {
          console.log(`  Removed from rankings: ${m.model_id}`);
          return false;
        }
        return true;
      });
      const removedCount = beforeLen - rankings.models.length;
      if (removedCount > 0) {
        changed = true;
        report.providers.openrouter.removed_rankings_applied = removedCount;
      }
    }

    // Remove stale NIM entries only when NIM fetch succeeded.
    if (nimFetchOk && nimRemoved.length > 0) {
      const beforeLen = rankings.models.length;
      rankings.models = rankings.models.filter((m: any) => {
        if (m.source === "nim" && nimRemoved.includes(m.model_id)) {
          console.log(`  Removed from rankings: ${m.model_id}`);
          return false;
        }
        return true;
      });
      const removedCount = beforeLen - rankings.models.length;
      if (removedCount > 0) {
        changed = true;
        report.providers.nim.removed_rankings = removedCount;
      }
    }

    // Refresh lookup map after removals.
    rankingsById.clear();
    for (const model of rankings.models) {
      rankingsById.set(model.model_id, model);
      rankingsById.set(normalizeModelId(model.model_id), model);
    }

    // Update existing entries with OpenCode support + AA metadata.
    for (const entry of rankings.models) {
      if (entry.source !== "nim" && entry.source !== "openrouter") continue;

      const provider = entry.source === "nim" ? "nvidia" : "openrouter";
      const supportState = isOpenCodeSupported(
        provider,
        entry.model_id,
        support,
      );
      if (supportState !== null && entry.opencode_supported !== supportState) {
        entry.opencode_supported = supportState;
        changed = true;
      }

      const aaHit = findAAMeta(entry.model_id, entry.name || "", aaLookup);
      if (mergeAAMeta(entry, aaHit)) changed = true;
    }

    // Add new NIM entries to rankings.
    for (const model of nimApiModels) {
      const existing = rankingsById.get(normalizeModelId(model.id));
      if (existing) continue;

      const aaHit = findAAMeta(model.id, model.name, aaLookup);
      const tier = deriveTier(aaHit, null);
      if (tier === "?") unresolvedTierModels.push(model.id);

      const supportState = isOpenCodeSupported("nvidia", model.id, support);

      const entry: any = {
        source: "nim",
        model_id: model.id,
        name: model.name,
        swe_bench: aaHit?.swe_bench ?? null,
        tier,
        context: formatContext(model.context),
        opencode_supported: supportState,
        aa_slug: aaHit?.aa_slug || "",
        aa_intelligence: aaHit?.aa_intelligence ?? null,
        aa_speed_tps: aaHit?.aa_speed_tps ?? null,
        aa_price_input: aaHit?.aa_price_input ?? null,
        aa_price_output: aaHit?.aa_price_output ?? null,
        aa_context: aaHit?.aa_context || "",
        aa_url: aaHit?.aa_url || "",
      };

      rankings.models.push(entry);
      rankingsById.set(entry.model_id, entry);
      rankingsById.set(normalizeModelId(entry.model_id), entry);

      console.log(
        `  Added NIM ranking: ${entry.model_id} [tier: ${entry.tier}]`,
      );
      changed = true;
      report.providers.nim.added_rankings += 1;
    }

    // Add new OpenRouter entries with AA + support metadata.
    for (const model of orNew) {
      const existing = rankingsById.get(normalizeModelId(model.id));
      if (existing && existing.source === "openrouter") continue;

      const bare = normalizeModelId(model.id);
      const nimTwin = rankingsById.get(bare);
      const aaHit = findAAMeta(model.id, model.name, aaLookup);

      const tier =
        deriveTier(aaHit, nimTwin?.swe_bench || null) || nimTwin?.tier || "?";
      if (tier === "?") unresolvedTierModels.push(model.id);

      const supportState = isOpenCodeSupported("openrouter", model.id, support);

      const entry: any = {
        source: "openrouter",
        model_id: model.id,
        name: model.name,
        swe_bench: aaHit?.swe_bench ?? nimTwin?.swe_bench ?? null,
        tier,
        context: formatContext(model.context),
        opencode_supported: supportState,
        aa_slug: aaHit?.aa_slug || nimTwin?.aa_slug || "",
        aa_intelligence:
          aaHit?.aa_intelligence ?? nimTwin?.aa_intelligence ?? null,
        aa_speed_tps: aaHit?.aa_speed_tps ?? nimTwin?.aa_speed_tps ?? null,
        aa_price_input:
          aaHit?.aa_price_input ?? nimTwin?.aa_price_input ?? null,
        aa_price_output:
          aaHit?.aa_price_output ?? nimTwin?.aa_price_output ?? null,
        aa_context: aaHit?.aa_context || nimTwin?.aa_context || "",
        aa_url: aaHit?.aa_url || nimTwin?.aa_url || "",
      };

      rankings.models.push(entry);
      rankingsById.set(entry.model_id, entry);
      rankingsById.set(normalizeModelId(entry.model_id), entry);

      console.log(
        `  Added OpenRouter ranking: ${entry.model_id} [tier: ${entry.tier}]`,
      );
      changed = true;
      report.providers.openrouter.added_rankings += 1;
    }

    if (changed) {
      writeFileSync(RANKINGS_PATH, JSON.stringify(rankings, null, 2) + "\n");
      console.log(`\n  ✓ Updated ${RANKINGS_PATH}`);
      report.rankings.changed = true;
    } else {
      console.log("\n  No ranking changes to apply.");
    }

    if (supportFetched || !existsSync(SUPPORT_PATH)) {
      writeSupportFile(support, supportFromGithub);
      console.log(`  ✓ Updated ${SUPPORT_PATH}`);
      changed = true;
    }
  } else {
    console.log("\n(dry run — pass --apply to write changes)");
  }

  report.rankings.unresolved_tier_models = [
    ...new Set(unresolvedTierModels),
  ].sort();

  if (REPORT_PATH) {
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log(`\n  ✓ Wrote report: ${REPORT_PATH}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n═══ SUMMARY ═══");
  console.log(
    `  NIM hardcoded:     +${nimNew.length} new, -${nimRemoved.length} removed`,
  );
  console.log(
    `  OpenRouter list:   +${orNew.length} new, -${orRemoved.length} removed`,
  );
  console.log(
    `  OpenCode support:  nvidia=${support.nvidia.size}, openrouter=${support.openrouter.size}`,
  );
  console.log(
    `  Missing rankings:  ${missingRankings.length} fetched models without ranking entries`,
  );
  console.log(
    `  Unresolved tiers:  ${report.rankings.unresolved_tier_models.length}`,
  );

  if (report.rankings.unresolved_tier_models.length) {
    console.log("\n  Models needing tier review:");
    for (const id of report.rankings.unresolved_tier_models) {
      console.log(`    ? ${id}`);
    }
  }

  if (
    !APPLY &&
    (nimNew.length || nimRemoved.length || orNew.length || orRemoved.length)
  ) {
    console.log("\n  Next steps:");
    console.log("    1. Run with --apply to update ranking/support files");
    console.log(
      "    2. Review NIM hardcoded list updates in src/lib/models.ts (if required)",
    );
    console.log(
      "    3. Check unresolved tiers against artificialanalysis.ai and set manually if needed",
    );
  }

  if (
    FAIL_ON_UNRESOLVED_TIER &&
    report.rankings.unresolved_tier_models.length > 0
  ) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
