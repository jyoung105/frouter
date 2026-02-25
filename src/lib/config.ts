// src/lib/config.ts — BYOK key management, first-run wizard, config I/O
import {
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
  copyFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { R, B, D, RED, GREEN, CYAN } from "./utils.js";

export const CONFIG_PATH = join(homedir(), ".frouter.json");

// ─── Provider metadata ────────────────────────────────────────────────────────
export const PROVIDERS_META = {
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

export function loadConfig() {
  const defaults = {
    apiKeys: {},
    providers: {
      nvidia: { enabled: true },
      openrouter: { enabled: true },
    },
  };
  if (!existsSync(CONFIG_PATH)) return defaults;
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return {
      apiKeys: parsed.apiKeys || {},
      providers: parsed.providers || defaults.providers,
    };
  } catch {
    try {
      const backupPath = `${CONFIG_PATH}.corrupt-${Date.now()}`;
      copyFileSync(CONFIG_PATH, backupPath);
      try {
        chmodSync(backupPath, 0o600);
      } catch {
        /* best-effort */
      }
      process.stderr.write(
        `Warning: malformed config at ${CONFIG_PATH}; backup saved to ${backupPath}\n`,
      );
    } catch {
      /* best-effort */
    }
    return defaults;
  }
}

export function saveConfig(config) {
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
export function getApiKey(config, providerKey) {
  const meta = PROVIDERS_META[providerKey];
  if (!meta) return null;
  return process.env[meta.envVar] || config?.apiKeys?.[providerKey] || null;
}

export function normalizeApiKeyInput(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateProviderApiKey(providerKey, rawValue) {
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

export function openBrowser(url) {
  const commands = {
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

/**
 * 2-provider sequential wizard.
 * For each provider: open browser → masked key input → validate prefix → save.
 * Returns updated config.
 */
export async function runFirstRunWizard(config: any) {
  const w = (s: string) => process.stdout.write(s);

  w("\x1b[2J\x1b[H");
  w(`${B}  frouter — Free Model Router${R}\n`);
  w(`${D}  Let's set up your API keys (ESC to skip any provider)${R}\n\n`);

  for (const [pk, meta] of Object.entries(PROVIDERS_META)) {
    w(`${B}  ● ${meta.name}${R}\n`);
    w(`${D}    Free key at: ${CYAN}${meta.signupUrl}${R}\n`);

    const wantKey = await promptMasked(
      `  Open browser for ${meta.name} key? (y/ESC to skip): `,
    );
    if (wantKey && wantKey.toLowerCase().startsWith("y")) {
      openBrowser(meta.signupUrl);
      w(`${D}    (browser opened — copy your key, then come back)${R}\n`);
    }
    if (!wantKey) {
      w(`${D}  Skipped${R}\n\n`);
      continue;
    }

    // Keep prompting until a valid key is entered or user presses ESC to skip.
    while (true) {
      const key = await promptMasked(
        `  Paste ${meta.name} key (ESC to skip): `,
      );
      if (!key) {
        w(`${D}  Skipped${R}\n\n`);
        break;
      }

      const checked = validateProviderApiKey(pk, key);
      if (!checked.ok) {
        w(`${RED}  ✗ ${checked.reason}. Try again or press ESC to skip.${R}\n`);
        continue;
      }

      config.apiKeys[pk] = checked.key;
      w(`${GREEN}  ✓ Key saved${R}\n\n`);
      break;
    }
  }

  saveConfig(config);
  const n = Object.keys(config.apiKeys).length;
  w(`${GREEN}  ${n} key(s) saved → ~/.frouter.json${R}\n`);
  await new Promise((r) => setTimeout(r, 1200));
  return config;
}
