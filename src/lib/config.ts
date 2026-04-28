// src/lib/config.ts — BYOK key management, first-run wizard, config I/O
import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

export const CONFIG_PATH = join(homedir(), ".free-router.json");
export const LEGACY_CONFIG_PATH = join(homedir(), ".frouter.json");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProviderMeta = {
  name: string;
  envVar: string;
  keyPrefix: string;
  signupUrl: string;
  chatUrl: string;
  modelsUrl: string;
  testModel: string;
};

export type FrouterConfig = {
  apiKeys: Record<string, string>;
  providers: Record<string, { enabled: boolean }>;
  ui: { scrollSortPauseMs: number };
};

export type FreeRouterConfig = FrouterConfig;

// ─── Provider metadata ────────────────────────────────────────────────────────
export const PROVIDERS_META: Record<string, ProviderMeta> = {
  nvidia: {
    name: "NVIDIA NIM",
    envVar: "NVIDIA_API_KEY",
    keyPrefix: "nvapi-",
    signupUrl: "https://build.nvidia.com/settings/api-keys",
    chatUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    modelsUrl: "https://integrate.api.nvidia.com/v1/models",
    testModel: "meta/llama-3.1-8b-instruct",
  },
  openrouter: {
    name: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    keyPrefix: "sk-or-",
    signupUrl: "https://openrouter.ai/settings/keys",
    chatUrl: "https://openrouter.ai/api/v1/chat/completions",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    testModel: "mistralai/mistral-small-3.2-24b-instruct:free",
  },
};

// ─── Config I/O ───────────────────────────────────────────────────────────────

function readConfigFile(path: string, defaults: FrouterConfig): FrouterConfig {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      apiKeys: parsed.apiKeys || {},
      providers: parsed.providers || defaults.providers,
      ui: parsed.ui && typeof parsed.ui === "object" ? parsed.ui : defaults.ui,
    };
  } catch {
    try {
      const backupPath = `${path}.corrupt-${Date.now()}`;
      copyFileSync(path, backupPath);
      try {
        chmodSync(backupPath, 0o600);
      } catch {
        /* best-effort */
      }
      process.stderr.write(
        `Warning: malformed config at ${path}; backup saved to ${backupPath}\n`,
      );
    } catch {
      /* best-effort */
    }
    return defaults;
  }
}

function migrateLegacyConfigIfNeeded(defaults: FrouterConfig): FrouterConfig {
  const config = readConfigFile(LEGACY_CONFIG_PATH, defaults);
  if (existsSync(CONFIG_PATH)) return config;

  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
    });
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* best-effort: current process can still use the legacy config */
  }
  return config;
}

export function loadConfig(): FrouterConfig {
  const defaults = {
    apiKeys: {},
    providers: {
      nvidia: { enabled: true },
      openrouter: { enabled: true },
    },
    ui: {
      scrollSortPauseMs: 1500,
    },
  };
  if (existsSync(CONFIG_PATH)) return readConfigFile(CONFIG_PATH, defaults);
  if (existsSync(LEGACY_CONFIG_PATH)) return migrateLegacyConfigIfNeeded(defaults);
  return defaults;
}

export function saveConfig(config: FrouterConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* best-effort */
  }
}

/**
 * Priority: env var > config file > null (keyless ping)
 */
export function getApiKey(
  config: FrouterConfig,
  providerKey: string,
): string | null {
  const meta = PROVIDERS_META[providerKey];
  if (!meta) return null;
  return process.env[meta.envVar] || config?.apiKeys?.[providerKey] || null;
}

export function normalizeApiKeyInput(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateProviderApiKey(providerKey: string, rawValue: unknown) {
  const meta = PROVIDERS_META[providerKey];
  if (!meta) return { ok: false, reason: `Unknown provider: ${providerKey}` };

  const key = normalizeApiKeyInput(rawValue);
  if (!key) return { ok: false, reason: "API key is empty" };
  if (/\s/.test(key))
    return { ok: false, reason: "API key must not contain whitespace" };
  if (meta.keyPrefix && !key.startsWith(meta.keyPrefix)) {
    return { ok: false, reason: `Expected prefix "${meta.keyPrefix}"` };
  }
  return { ok: true, key };
}

// ─── Browser helper ───────────────────────────────────────────────────────────

export function openBrowser(url: string) {
  const commands: Record<string, string> = {
    darwin: `open "${url}"`,
    win32: `start "" "${url}"`,
  };
  const cmd = commands[process.platform] ?? `xdg-open "${url}"`;
  try {
    execSync(cmd, { stdio: "ignore" });
  } catch {
    /* best-effort */
  }
}

// ─── Masked single-line key input ─────────────────────────────────────────────

export function promptMasked(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(promptText);
    let buf = "";
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    function finish(val: string) {
      process.stdin.removeListener("data", handler);
      try {
        process.stdin.setRawMode(wasRaw || false);
      } catch {
        /* best-effort */
      }
      process.stdout.write("\n");
      resolve(val);
    }

    function handler(ch: string) {
      if (ch === "\r" || ch === "\n") {
        finish(buf);
      } else if (ch === "\x03") {
        // Ctrl+C
        process.stdout.write("\n");
        process.stdin.removeListener("data", handler);
        try {
          process.stdin.setRawMode(wasRaw || false);
        } catch {
          /* best-effort */
        }
        process.exit(0);
      } else if (ch === "\x1b") {
        // ESC = skip
        finish("");
      } else if (ch === "\x7f") {
        // backspace
        if (buf.length) {
          buf = buf.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (ch >= " ") {
        buf += ch;
        process.stdout.write("\u2022"); // bullet mask
      }
    }

    process.stdin.on("data", handler);
  });
}

// ─── First-run wizard ─────────────────────────────────────────────────────────

export type FirstRunOutcome = {
  config: FrouterConfig;
  starPromptHandled: boolean;
  startupSearchRequested: boolean;
};

export async function runFirstRunWizard(
  config: FrouterConfig,
): Promise<FirstRunOutcome> {
  const [{ render }, { createElement }, { FirstRunApp }] = await Promise.all([
    import("ink"),
    import("react"),
    import("../tui/first-run-app.js"),
  ]);

  const result = await new Promise<{
    apiKeys: Record<string, string>;
    starPromptHandled: boolean;
    startupSearchRequested: boolean;
  }>((resolve) => {
    let resolved = false;
    const element = createElement(FirstRunApp, {
      providers: PROVIDERS_META,
      validateKey: validateProviderApiKey,
      openBrowser,
      onDone: (r) => {
        if (resolved) return;
        resolved = true;
        instance.unmount();
        resolve(r);
      },
    });
    const instance = render(element, { exitOnCtrlC: false });
  });

  config.apiKeys = { ...config.apiKeys, ...result.apiKeys };
  saveConfig(config);
  return {
    config,
    starPromptHandled: result.starPromptHandled,
    startupSearchRequested: result.startupSearchRequested,
  };
}
