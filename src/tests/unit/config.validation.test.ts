import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { importFresh } from '../helpers/import-fresh.js';
import { ROOT_DIR } from '../helpers/test-paths.js';
import { cleanupTempHome, makeTempHome } from '../helpers/temp-home.js';

const CONFIG_MODULE_PATH = join(ROOT_DIR, 'lib', 'config.js');

async function withFreshModule(fn) {
  const home = makeTempHome();
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const mod = await importFresh(CONFIG_MODULE_PATH);
    await fn({ home, ...mod });
  } finally {
    if (prevHome == null) delete process.env.HOME;
    else process.env.HOME = prevHome;
    cleanupTempHome(home);
  }
}

// ─── normalizeApiKeyInput ────────────────────────────────────────────────────

test('normalizeApiKeyInput trims whitespace from string', async () => {
  await withFreshModule(async ({ normalizeApiKeyInput }) => {
    assert.equal(normalizeApiKeyInput('  nvapi-test  '), 'nvapi-test');
  });
});

test('normalizeApiKeyInput returns empty string for non-string input', async () => {
  await withFreshModule(async ({ normalizeApiKeyInput }) => {
    assert.equal(normalizeApiKeyInput(null), '');
    assert.equal(normalizeApiKeyInput(undefined), '');
    assert.equal(normalizeApiKeyInput(42), '');
  });
});

test('normalizeApiKeyInput returns empty string for empty string', async () => {
  await withFreshModule(async ({ normalizeApiKeyInput }) => {
    assert.equal(normalizeApiKeyInput(''), '');
    assert.equal(normalizeApiKeyInput('   '), '');
  });
});

// ─── validateProviderApiKey ──────────────────────────────────────────────────

test('validateProviderApiKey rejects empty key', async () => {
  await withFreshModule(async ({ validateProviderApiKey }) => {
    const result = validateProviderApiKey('nvidia', '');
    assert.equal(result.ok, false);
    assert.match(result.reason, /empty/i);
  });
});

test('validateProviderApiKey rejects key with whitespace', async () => {
  await withFreshModule(async ({ validateProviderApiKey }) => {
    const result = validateProviderApiKey('nvidia', 'nvapi-has space');
    assert.equal(result.ok, false);
    assert.match(result.reason, /whitespace/i);
  });
});

test('validateProviderApiKey rejects unknown provider', async () => {
  await withFreshModule(async ({ validateProviderApiKey }) => {
    const result = validateProviderApiKey('unknown-provider', 'some-key');
    assert.equal(result.ok, false);
    assert.match(result.reason, /Unknown provider/);
  });
});

test('validateProviderApiKey accepts valid nvidia key with correct prefix', async () => {
  await withFreshModule(async ({ validateProviderApiKey }) => {
    const result = validateProviderApiKey('nvidia', 'nvapi-valid-key-123');
    assert.equal(result.ok, true);
    assert.equal(result.key, 'nvapi-valid-key-123');
  });
});

test('validateProviderApiKey accepts valid openrouter key with correct prefix', async () => {
  await withFreshModule(async ({ validateProviderApiKey }) => {
    const result = validateProviderApiKey('openrouter', 'sk-or-valid-key-456');
    assert.equal(result.ok, true);
    assert.equal(result.key, 'sk-or-valid-key-456');
  });
});

test('validateProviderApiKey rejects nvidia key with openrouter prefix', async () => {
  await withFreshModule(async ({ validateProviderApiKey }) => {
    const result = validateProviderApiKey('nvidia', 'sk-or-wrong-provider');
    assert.equal(result.ok, false);
    assert.match(result.reason, /Expected prefix "nvapi-"/);
  });
});

test('validateProviderApiKey trims input before validation', async () => {
  await withFreshModule(async ({ validateProviderApiKey }) => {
    const result = validateProviderApiKey('nvidia', '  nvapi-trimmed  ');
    assert.equal(result.ok, true);
    assert.equal(result.key, 'nvapi-trimmed');
  });
});

// ─── PROVIDERS_META ──────────────────────────────────────────────────────────

test('PROVIDERS_META contains required fields for each provider', async () => {
  await withFreshModule(async ({ PROVIDERS_META }) => {
    for (const [pk, meta] of Object.entries(PROVIDERS_META)) {
      assert.ok(meta.name, `${pk} missing name`);
      assert.ok(meta.envVar, `${pk} missing envVar`);
      assert.ok(meta.keyPrefix, `${pk} missing keyPrefix`);
      assert.ok(meta.signupUrl, `${pk} missing signupUrl`);
      assert.ok(meta.chatUrl, `${pk} missing chatUrl`);
      assert.ok(meta.modelsUrl, `${pk} missing modelsUrl`);
      assert.ok(meta.testModel, `${pk} missing testModel`);
    }
  });
});

test('PROVIDERS_META has nvidia and openrouter providers', async () => {
  await withFreshModule(async ({ PROVIDERS_META }) => {
    assert.ok('nvidia' in PROVIDERS_META);
    assert.ok('openrouter' in PROVIDERS_META);
  });
});

// ─── getApiKey edge cases ────────────────────────────────────────────────────

test('getApiKey returns config key when env var is not set', async () => {
  await withFreshModule(async ({ getApiKey }) => {
    delete process.env.NVIDIA_API_KEY;
    const key = getApiKey({ apiKeys: { nvidia: 'nvapi-from-config' } }, 'nvidia');
    assert.equal(key, 'nvapi-from-config');
  });
});

test('getApiKey returns null when neither env nor config has key', async () => {
  await withFreshModule(async ({ getApiKey }) => {
    delete process.env.NVIDIA_API_KEY;
    const key = getApiKey({ apiKeys: {} }, 'nvidia');
    assert.equal(key, null);
  });
});

test('getApiKey handles missing apiKeys object gracefully', async () => {
  await withFreshModule(async ({ getApiKey }) => {
    delete process.env.NVIDIA_API_KEY;
    const key = getApiKey({}, 'nvidia');
    assert.equal(key, null);
  });
});

test('getApiKey handles null config gracefully', async () => {
  await withFreshModule(async ({ getApiKey }) => {
    delete process.env.NVIDIA_API_KEY;
    const key = getApiKey(null, 'nvidia');
    assert.equal(key, null);
  });
});
