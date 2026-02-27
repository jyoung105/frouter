// src/lib/targets.ts — write config to OpenCode and OpenClaw
import { execSync, spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
  statSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { PROVIDERS_META, validateProviderApiKey } from "./config.js";

const OPENCODE_PATH = join(homedir(), ".config", "opencode", "opencode.json");
const OPENCLAW_PATH = join(homedir(), ".openclaw", "openclaw.json");
const IS_WIN = platform() === "win32";
let cachedOpenCodeConfig: Record<string, any> | null = null;
let cachedOpenCodeConfigFingerprint: string | null = null;

function readJson(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function readOpenCodeFingerprint() {
  if (!existsSync(OPENCODE_PATH)) return "missing";
  try {
    const stat = statSync(OPENCODE_PATH);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

function readOpenCodeConfig(force = false) {
  const fingerprint = readOpenCodeFingerprint();
  if (
    !force &&
    cachedOpenCodeConfig &&
    cachedOpenCodeConfigFingerprint === fingerprint
  ) {
    return cachedOpenCodeConfig;
  }
  cachedOpenCodeConfig = readJson(OPENCODE_PATH);
  cachedOpenCodeConfigFingerprint = fingerprint;
  return cachedOpenCodeConfig;
}

function backupAndWriteJson(path, data) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (existsSync(path)) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(path, `${path}.backup-${ts}`);
  }
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

function getProviderMeta(providerKey) {
  const meta = PROVIDERS_META[providerKey];
  if (!meta) throw new Error(`Unknown provider "${providerKey}"`);
  return meta;
}

function resolvePersistedApiKey(
  providerKey: string,
  apiKey: string | null,
  options: { persistApiKey?: boolean } = {},
) {
  if (!options.persistApiKey || !apiKey) return null;
  const checked = validateProviderApiKey(providerKey, apiKey);
  if (!checked.ok) {
    throw new Error(
      `Refusing to persist invalid ${providerKey} API key: ${checked.reason}`,
    );
  }
  return checked.key;
}

/** Check whether a binary is available on PATH. */
function hasBinary(bin: string) {
  try {
    execSync(IS_WIN ? `where ${bin}` : `which ${bin}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ─── OpenCode installation detection ─────────────────────────────────────────

export function isOpenCodeInstalled() {
  return hasBinary("opencode");
}

export function detectAvailableInstallers() {
  const installers = [];
  if (hasBinary("npm"))
    installers.push({
      id: "npm",
      label: "npm",
      command: "npm install -g opencode",
    });
  if (platform() === "darwin" && hasBinary("brew")) {
    installers.push({
      id: "brew",
      label: "Homebrew",
      command: "brew install opencode",
    });
  }
  if (hasBinary("go"))
    installers.push({
      id: "go",
      label: "Go",
      command: "go install github.com/opencode-ai/opencode@latest",
    });
  return installers;
}

export function installOpenCode(installer: { command: string }) {
  try {
    const result = spawnSync(installer.command, {
      stdio: "inherit",
      shell: true,
      timeout: 120_000,
    });
    if (result.status === 0) return { ok: true };
    return { ok: false, error: `Command exited with code ${result.status}` };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ─── Provider config blocks ───────────────────────────────────────────────────

function getBaseUrl(meta) {
  return meta.chatUrl.replace("/chat/completions", "");
}

function openCodeProviderBlock(providerKey, apiKey) {
  const meta = getProviderMeta(providerKey);
  return {
    npm: "@ai-sdk/openai-compatible",
    name: meta.name,
    options: {
      baseURL: getBaseUrl(meta),
      apiKey: apiKey || `{env:${meta.envVar}}`,
    },
  };
}

const OPENCODE_PROVIDER_FALLBACKS: Record<
  string,
  { providerKey: string; modelId: string }
> = {
  // models.dev currently lists Stepfun 3.5 Flash under OpenRouter, not NVIDIA.
  "nvidia:stepfun-ai/step-3.5-flash": {
    providerKey: "openrouter",
    modelId: "stepfun/step-3.5-flash:free",
  },
};

function assertOpenCodeCompatible(model) {
  if (model?.opencodeSupported === false) {
    throw new Error(
      `Model "${model.id}" is not marked as OpenCode-supported. Pick another model or refresh model metadata.`,
    );
  }
}

function modelTail(id: string): string {
  return (
    id
      .replace(/:free$/i, "")
      .split("/")
      .pop()
      ?.toLowerCase() || ""
  );
}

function findFallbackModel(
  allModels: any[],
  providerKey: string,
  modelId: string,
): any | null {
  if (!Array.isArray(allModels) || !allModels.length) return null;
  return (
    allModels.find(
      (m) => m?.providerKey === providerKey && m?.id === modelId,
    ) ||
    allModels.find(
      (m) =>
        m?.providerKey === providerKey &&
        modelTail(m?.id || "") === modelTail(modelId),
    ) ||
    null
  );
}

// ─── OpenCode ────────────────────────────────────────────────────────────────

/**
 * Merge frouter provider block into OpenCode config and set active model.
 * Preserves all existing keys (other providers, plugins, etc.).
 */
export function writeOpenCode(model, providerKey, apiKey = null, options = {}) {
  assertOpenCodeCompatible(model);
  const persistedApiKey = resolvePersistedApiKey(providerKey, apiKey, options);
  const currentCfg = readOpenCodeConfig();
  const nextCfg = {
    ...currentCfg,
    provider: {
      ...(currentCfg.provider ?? {}),
      [providerKey]: openCodeProviderBlock(providerKey, persistedApiKey),
    },
    model: `${providerKey}/${model.id}`,
  };

  if (JSON.stringify(nextCfg) === JSON.stringify(currentCfg)) {
    return OPENCODE_PATH;
  }

  backupAndWriteJson(OPENCODE_PATH, nextCfg);
  cachedOpenCodeConfig = nextCfg;
  cachedOpenCodeConfigFingerprint = readOpenCodeFingerprint();
  return OPENCODE_PATH;
}

/**
 * Resolve model selection for OpenCode config.
 * Always respects the user's explicit provider choice — if the user selected
 * a model from NIM (or any provider), that exact provider/model is used.
 */
export function resolveOpenCodeSelection(model, providerKey, _allModels = []) {
  const fallbackRule =
    OPENCODE_PROVIDER_FALLBACKS[`${providerKey}:${model?.id}`];
  if (!fallbackRule) return { model, providerKey, fallback: false };

  const fallbackModel = findFallbackModel(
    _allModels,
    fallbackRule.providerKey,
    fallbackRule.modelId,
  );
  if (!fallbackModel) {
    return {
      model: {
        ...model,
        id: fallbackRule.modelId,
        providerKey: fallbackRule.providerKey,
      },
      providerKey: fallbackRule.providerKey,
      fallback: true,
    };
  }

  return {
    model: fallbackModel,
    providerKey: fallbackRule.providerKey,
    fallback: true,
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
  const cfg = readJson(OPENCLAW_PATH);
  const qid = `${providerKey}/${model.id}`;

  cfg.models ??= {};
  cfg.models.providers ??= {};
  cfg.models.providers[providerKey] = {
    baseUrl: getBaseUrl(meta),
    api: "openai-completions",
  };

  if (persistedApiKey) {
    cfg.env ??= {};
    cfg.env[meta.envVar] = persistedApiKey;
  } else if (cfg.env?.[meta.envVar]) {
    delete cfg.env[meta.envVar];
    if (Object.keys(cfg.env).length === 0) delete cfg.env;
  }

  cfg.agents ??= {};
  cfg.agents.defaults ??= {};
  cfg.agents.defaults.model ??= {};
  cfg.agents.defaults.model.primary = qid;
  cfg.agents.defaults.models ??= {};
  cfg.agents.defaults.models[qid] = {};

  backupAndWriteJson(OPENCLAW_PATH, cfg);
  return OPENCLAW_PATH;
}
