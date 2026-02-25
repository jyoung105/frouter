import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllModels } from '../../lib/models.js';

async function withCleanEnv(run: () => Promise<void>) {
  const prevNv = process.env.NVIDIA_API_KEY;
  const prevOr = process.env.OPENROUTER_API_KEY;
  const prevNoFetch = process.env.FROUTER_NO_FETCH;

  delete process.env.NVIDIA_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  process.env.FROUTER_NO_FETCH = '1';

  try {
    await run();
  } finally {
    if (prevNv == null) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = prevNv;

    if (prevOr == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevOr;

    if (prevNoFetch == null) delete process.env.FROUTER_NO_FETCH;
    else process.env.FROUTER_NO_FETCH = prevNoFetch;
  }
}

// ─── Model structure ─────────────────────────────────────────────────────────

test('each hardcoded NIM model has required fields', async () => {
  await withCleanEnv(async () => {
    const models = await getAllModels({
      apiKeys: { nvidia: 'nvapi-test' },
      providers: {
        nvidia: { enabled: true },
        openrouter: { enabled: false },
      },
    });

    assert.ok(models.length > 50, `Expected 50+ NIM models, got ${models.length}`);

    for (const m of models) {
      assert.ok(typeof m.id === 'string' && m.id.length > 0, `Model missing id`);
      assert.ok(typeof m.displayName === 'string' && m.displayName.length > 0, `Model ${m.id} missing displayName`);
      assert.ok(typeof m.context === 'number' && m.context > 0, `Model ${m.id} missing context`);
      assert.equal(m.providerKey, 'nvidia', `Model ${m.id} has wrong providerKey`);
      assert.ok(Array.isArray(m.pings), `Model ${m.id} missing pings array`);
      assert.equal(m.status, 'pending', `Model ${m.id} should start as pending`);
      assert.equal(m.httpCode, null, `Model ${m.id} should start with null httpCode`);
    }
  });
});

test('models are enriched with tier information from rankings', async () => {
  await withCleanEnv(async () => {
    const models = await getAllModels({
      apiKeys: { nvidia: 'nvapi-test' },
      providers: {
        nvidia: { enabled: true },
        openrouter: { enabled: false },
      },
    });

    // Known high-tier model that should be in rankings
    const llama = models.find(m => m.id === 'meta/llama-3.3-70b-instruct');
    if (llama) {
      assert.ok(llama.tier, `Llama 3.3 70B should have a tier`);
      assert.ok(typeof llama.tier === 'string', `tier should be a string`);
    }

    // Check that at least some models have tier information
    const withTier = models.filter(m => m.tier && m.tier !== '?');
    assert.ok(withTier.length > 10, `Expected 10+ models with tier info, got ${withTier.length}`);
  });
});

test('models may have sweScore and aaIntelligence from rankings', async () => {
  await withCleanEnv(async () => {
    const models = await getAllModels({
      apiKeys: { nvidia: 'nvapi-test' },
      providers: {
        nvidia: { enabled: true },
        openrouter: { enabled: false },
      },
    });

    // At least some models should have intelligence scores
    const withIntel = models.filter(m => m.aaIntelligence != null);
    assert.ok(withIntel.length > 0, `Expected some models with aaIntelligence`);

    for (const m of withIntel) {
      assert.ok(typeof m.aaIntelligence === 'number', `aaIntelligence should be number for ${m.id}`);
    }
  });
});

test('models with sweScore get tier based on score thresholds', async () => {
  await withCleanEnv(async () => {
    const models = await getAllModels({
      apiKeys: { nvidia: 'nvapi-test' },
      providers: {
        nvidia: { enabled: true },
        openrouter: { enabled: false },
      },
    });

    const withSwe = models.filter(m => m.sweScore != null);
    for (const m of withSwe) {
      assert.ok(typeof m.sweScore === 'number', `sweScore should be number for ${m.id}`);
      assert.ok(
        ['S+', 'S', 'A+', 'A', 'A-', 'B+', 'B', 'C', '?'].includes(m.tier),
        `Model ${m.id} has unexpected tier: ${m.tier}`
      );
    }
  });
});

// ─── Provider filtering ──────────────────────────────────────────────────────

test('getAllModels only returns nvidia models when openrouter is disabled', async () => {
  await withCleanEnv(async () => {
    const models = await getAllModels({
      apiKeys: { nvidia: 'nvapi-test' },
      providers: {
        nvidia: { enabled: true },
        openrouter: { enabled: false },
      },
    });

    assert.ok(models.length > 0);
    assert.ok(models.every(m => m.providerKey === 'nvidia'));
  });
});

test('getAllModels returns empty when both providers are disabled (no-fetch mode)', async () => {
  await withCleanEnv(async () => {
    const models = await getAllModels({
      apiKeys: {},
      providers: {
        nvidia: { enabled: false },
        openrouter: { enabled: false },
      },
    });

    assert.equal(models.length, 0);
  });
});

test('getAllModels uses hardcoded NIM list when no API key is provided', async () => {
  await withCleanEnv(async () => {
    const models = await getAllModels({
      apiKeys: {},
      providers: {
        nvidia: { enabled: true },
        openrouter: { enabled: false },
      },
    });

    assert.ok(models.length > 50);
    assert.ok(models.every(m => m.providerKey === 'nvidia'));
  });
});

// ─── Known model IDs ─────────────────────────────────────────────────────────

test('hardcoded NIM list includes key models from each tier', async () => {
  await withCleanEnv(async () => {
    const models = await getAllModels({
      apiKeys: {},
      providers: {
        nvidia: { enabled: true },
        openrouter: { enabled: false },
      },
    });

    const ids = new Set(models.map(m => m.id));

    // S+ tier
    assert.ok(ids.has('qwen/qwen3-235b-a22b'), 'Missing Qwen3 235B');
    // S tier
    assert.ok(ids.has('deepseek-ai/deepseek-v3.1'), 'Missing DeepSeek V3.1');
    // A tier
    assert.ok(ids.has('meta/llama-3.1-405b-instruct'), 'Missing Llama 3.1 405B');
    // B tier
    assert.ok(ids.has('meta/llama-3.1-8b-instruct'), 'Missing Llama 3.1 8B');
    // C tier
    assert.ok(ids.has('mistralai/mixtral-8x7b-instruct-v0.1'), 'Missing Mixtral 8x7B');
  });
});

// ─── Model deduplication check ───────────────────────────────────────────────

test('hardcoded NIM list has no duplicate model IDs', async () => {
  await withCleanEnv(async () => {
    const models = await getAllModels({
      apiKeys: {},
      providers: {
        nvidia: { enabled: true },
        openrouter: { enabled: false },
      },
    });

    const ids = models.map(m => m.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, `Found ${ids.length - uniqueIds.size} duplicate model IDs`);
  });
});
