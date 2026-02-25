// lib/config.js — BYOK key management, first-run wizard, config I/O
import { readFileSync, writeFileSync, existsSync, chmodSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export const CONFIG_PATH = join(homedir(), '.frouter.json');

// ─── Provider metadata ────────────────────────────────────────────────────────
export const PROVIDERS_META = {
  nvidia: {
    name:       'NVIDIA NIM',
    envVar:     'NVIDIA_API_KEY',
    keyPrefix:  'nvapi-',
    signupUrl:  'https://build.nvidia.com/settings/api-keys',
    chatUrl:    'https://integrate.api.nvidia.com/v1/chat/completions',
    modelsUrl:  'https://integrate.api.nvidia.com/v1/models',
    testModel:  'meta/llama-3.1-8b-instruct',
  },
  openrouter: {
    name:       'OpenRouter',
    envVar:     'OPENROUTER_API_KEY',
    keyPrefix:  'sk-or-',
    signupUrl:  'https://openrouter.ai/settings/keys',
    chatUrl:    'https://openrouter.ai/api/v1/chat/completions',
    modelsUrl:  'https://openrouter.ai/api/v1/models',
    testModel:  'mistralai/mistral-small-3.2-24b-instruct:free',
  },
};

// ─── Config I/O ───────────────────────────────────────────────────────────────

export function loadConfig() {
  const defaults = {
    apiKeys:   {},
    providers: {
      nvidia:     { enabled: true },
      openrouter: { enabled: true },
    },
  };
  if (!existsSync(CONFIG_PATH)) return defaults;
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return {
      apiKeys:   parsed.apiKeys   || {},
      providers: parsed.providers || defaults.providers,
    };
  } catch {
    try {
      const backupPath = `${CONFIG_PATH}.corrupt-${Date.now()}`;
      copyFileSync(CONFIG_PATH, backupPath);
      try { chmodSync(backupPath, 0o600); } catch { /* best-effort */ }
      process.stderr.write(`Warning: malformed config at ${CONFIG_PATH}; backup saved to ${backupPath}\n`);
    } catch { /* best-effort */ }
    return defaults;
  }
}

export function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  try { chmodSync(CONFIG_PATH, 0o600); } catch { /* best-effort */ }
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
  return typeof value === 'string' ? value.trim() : '';
}

export function validateProviderApiKey(providerKey, rawValue) {
  const meta = PROVIDERS_META[providerKey];
  if (!meta) return { ok: false, reason: `Unknown provider: ${providerKey}` };

  const key = normalizeApiKeyInput(rawValue);
  if (!key) return { ok: false, reason: 'API key is empty' };
  if (/\s/.test(key)) return { ok: false, reason: 'API key must not contain whitespace' };
  if (meta.keyPrefix && !key.startsWith(meta.keyPrefix)) {
    return { ok: false, reason: `Expected prefix "${meta.keyPrefix}"` };
  }
  return { ok: true, key };
}

// ─── Browser helper ───────────────────────────────────────────────────────────

export function openBrowser(url) {
  try {
    if      (process.platform === 'darwin') execSync(`open "${url}"`,           { stdio: 'ignore' });
    else if (process.platform === 'win32')  execSync(`start "" "${url}"`,       { stdio: 'ignore' });
    else                                    execSync(`xdg-open "${url}"`,        { stdio: 'ignore' });
  } catch { /* best-effort */ }
}

// ─── Masked single-line key input ─────────────────────────────────────────────

export function promptMasked(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(promptText);
    let buf = '';
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const cleanup = () => {
      process.stdin.removeListener('data', handler);
      try { process.stdin.setRawMode(wasRaw || false); } catch { /* best-effort */ }
    };

    const handler = (ch: string) => {
      if (ch === '\r' || ch === '\n') {
        done(buf);
      } else if (ch === '\x03') {   // Ctrl+C
        process.stdout.write('\n');
        cleanup();
        process.exit(0);
      } else if (ch === '\x1b') {   // ESC = skip
        done('');
      } else if (ch === '\x7f') {   // backspace
        if (buf.length) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); }
      } else if (ch >= ' ') {
        buf += ch;
        process.stdout.write('\u2022'); // bullet mask
      }
    };

    function done(val: string) {
      cleanup();
      process.stdout.write('\n');
      resolve(val);
    }

    process.stdin.on('data', handler);
  });
}

// ─── First-run wizard ─────────────────────────────────────────────────────────

/**
 * 2-provider sequential wizard.
 * For each provider: open browser → masked key input → validate prefix → save.
 * Returns updated config.
 */
export async function runFirstRunWizard(config: any) {
  process.stdout.write('\x1b[2J\x1b[H');
  process.stdout.write('\x1b[1m  frouter — Free Model Router\x1b[0m\n');
  process.stdout.write('\x1b[2m  Let\'s set up your API keys (ESC to skip any provider)\x1b[0m\n\n');

  for (const [pk, meta] of Object.entries(PROVIDERS_META)) {
    process.stdout.write(`\x1b[1m  ● ${meta.name}\x1b[0m\n`);
    process.stdout.write(`\x1b[2m    Free key at: \x1b[36m${meta.signupUrl}\x1b[0m\n`);

    const wantKey = await promptMasked(`  Open browser for ${meta.name} key? (y/ESC to skip): `);
    if (wantKey && wantKey.toLowerCase().startsWith('y')) {
      openBrowser(meta.signupUrl);
      process.stdout.write(`\x1b[2m    (browser opened — copy your key, then come back)\x1b[0m\n`);
    }
    if (!wantKey) { process.stdout.write(`\x1b[2m  Skipped\x1b[0m\n\n`); continue; }

    // Keep prompting until a valid key is entered or user presses ESC to skip.
    while (true) {
      const key = await promptMasked(`  Paste ${meta.name} key (ESC to skip): `);
      if (!key) {
        process.stdout.write(`\x1b[2m  Skipped\x1b[0m\n\n`);
        break;
      }

      const checked = validateProviderApiKey(pk, key);
      if (!checked.ok) {
        process.stdout.write(`\x1b[31m  ✗ ${checked.reason}. Try again or press ESC to skip.\x1b[0m\n`);
        continue;
      }

      config.apiKeys[pk] = checked.key;
      process.stdout.write(`\x1b[32m  ✓ Key saved\x1b[0m\n\n`);
      break;
    }
  }

  saveConfig(config);
  const n = Object.keys(config.apiKeys).length;
  process.stdout.write(`\x1b[32m  ${n} key(s) saved → ~/.frouter.json\x1b[0m\n`);
  await new Promise(r => setTimeout(r, 1200));
  return config;
}
