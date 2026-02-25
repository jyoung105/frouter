import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { getAllModels } from '../../lib/models.js';

type MockOutcome =
  | { type: 'response'; statusCode?: number; body: string }
  | { type: 'error'; error?: Error }
  | { type: 'timeout' };

type ProviderConfig = {
  apiKeys?: Record<string, string>;
  providers?: Record<string, { enabled: boolean }>;
};

function makeConfig(partial: ProviderConfig = {}) {
  return {
    apiKeys: {},
    providers: {
      nvidia: { enabled: true },
      openrouter: { enabled: true },
    },
    ...partial,
  };
}

async function withCleanApiKeyEnv(run: () => Promise<void>) {
  const prevNv = process.env.NVIDIA_API_KEY;
  const prevOr = process.env.OPENROUTER_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    await run();
  } finally {
    if (prevNv == null) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = prevNv;

    if (prevOr == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevOr;
  }
}

async function withNoFetchEnv(value: string | undefined, run: () => Promise<void>) {
  const prev = process.env.FROUTER_NO_FETCH;
  if (value == null) delete process.env.FROUTER_NO_FETCH;
  else process.env.FROUTER_NO_FETCH = value;
  try {
    await run();
  } finally {
    if (prev == null) delete process.env.FROUTER_NO_FETCH;
    else process.env.FROUTER_NO_FETCH = prev;
  }
}

async function withMockedHttps(responder: (opts: any) => MockOutcome, run: () => Promise<void>) {
  const originalRequest = https.request;

  (https as any).request = ((opts: any, onResponse: (res: any) => void) => {
    const req = new EventEmitter() as any;
    let onTimeout: (() => void) | null = null;

    req.setTimeout = (_ms: number, cb: () => void) => {
      onTimeout = cb;
      return req;
    };
    req.destroy = () => {};
    req.write = () => {};
    req.end = () => {
      const outcome = responder(opts);
      setImmediate(() => {
        if (outcome.type === 'error') {
          req.emit('error', outcome.error ?? new Error('mock https error'));
          return;
        }
        if (outcome.type === 'timeout') {
          onTimeout?.();
          return;
        }

        const res = new EventEmitter() as any;
        res.statusCode = outcome.statusCode ?? 200;
        onResponse(res);
        if (outcome.body) res.emit('data', outcome.body);
        res.emit('end');
      });
    };

    return req;
  }) as any;

  try {
    await run();
  } finally {
    (https as any).request = originalRequest;
  }
}

test('getAllModels happy path: uses bundled NVIDIA list when fetch is disabled', async () => {
  await withCleanApiKeyEnv(async () => {
    await withNoFetchEnv('1', async () => {
      const models = await getAllModels(makeConfig({
        apiKeys: {
          nvidia: 'nvapi-demo',
          openrouter: 'sk-or-demo',
        },
      }));

      assert.ok(models.length > 20, `expected bundled NIM list, got ${models.length}`);
      assert.equal(models.some((m) => m.providerKey === 'openrouter'), false);

      const sample = models.find((m) => m.id === 'meta/llama-3.1-8b-instruct');
      assert.ok(sample, 'expected known hardcoded NVIDIA model');
      assert.equal(sample.status, 'pending');
      assert.equal(sample.httpCode, null);
      assert.deepEqual(sample.pings, []);
    });
  });
});

test('getAllModels edge case: returns empty list when all available fetch paths are disabled', async () => {
  await withCleanApiKeyEnv(async () => {
    await withNoFetchEnv('1', async () => {
      const models = await getAllModels(makeConfig({
        providers: {
          nvidia: { enabled: false },
          openrouter: { enabled: true },
        },
      }));

      assert.deepEqual(models, []);
    });
  });
});

test('getAllModels happy path: merges fetched NVIDIA chat models and free OpenRouter models', async () => {
  await withCleanApiKeyEnv(async () => {
    await withNoFetchEnv(undefined, async () => {
      await withMockedHttps((opts) => {
        if (opts.hostname === 'integrate.api.nvidia.com' && opts.path === '/v1/models') {
          return {
            type: 'response',
            body: JSON.stringify({
              data: [
                { id: 'acme/chat-lite', context_length: 8192 },
                { id: 'acme/embed-large-v1', context_length: 1024 }, // filtered out
                { id: 'meta/llama-3.1-8b-instruct', context_length: 131072 },
              ],
            }),
          };
        }

        if (opts.hostname === 'openrouter.ai' && opts.path === '/api/v1/models') {
          return {
            type: 'response',
            body: JSON.stringify({
              data: [
                {
                  id: 'meta-llama/llama-3.1-8b-instruct:free',
                  name: 'Llama Free',
                  context_length: 128000,
                  pricing: { prompt: '0', completion: '0' },
                  supported_parameters: ['tools', 'max_tokens', 'temperature'],
                },
                {
                  id: 'meta-llama/llama-3.1-8b-instruct:paid',
                  pricing: { prompt: '0', completion: '0.001' },
                  supported_parameters: ['tools', 'max_tokens'],
                },
                {
                  id: 'qwen/qwen2.5-coder-32b-instruct:free',
                  pricing: { prompt: '0', completion: '0' },
                  supported_parameters: ['tools', 'max_tokens'],
                },
                {
                  id: 'liquid/lfm-no-tools:free',
                  pricing: { prompt: '0', completion: '0' },
                  supported_parameters: ['max_tokens', 'temperature'],
                },
              ],
            }),
          };
        }

        return { type: 'error', error: new Error(`unexpected request: ${opts.hostname}${opts.path}`) };
      }, async () => {
        const models = await getAllModels(makeConfig({
          apiKeys: {
            nvidia: 'nvapi-test',
            openrouter: 'sk-or-test',
          },
        }));

        const nvidia = models.filter((m) => m.providerKey === 'nvidia');
        const openrouter = models.filter((m) => m.providerKey === 'openrouter');

        assert.equal(nvidia.length, 2);
        assert.deepEqual(
          nvidia.map((m) => m.id).sort(),
          ['acme/chat-lite', 'meta/llama-3.1-8b-instruct'].sort()
        );

        assert.equal(openrouter.length, 2);
        assert.equal(openrouter.some((m) => /:paid$/.test(m.id)), false);
        assert.ok(openrouter.every((m) => m.status === 'pending' && Array.isArray(m.pings)));
      });
    });
  });
});

test('getAllModels error scenario: falls back safely when provider fetches fail', async () => {
  await withCleanApiKeyEnv(async () => {
    await withNoFetchEnv(undefined, async () => {
      await withMockedHttps((opts) => {
        if (opts.hostname === 'integrate.api.nvidia.com') {
          return { type: 'response', body: '{ malformed-json' };
        }
        if (opts.hostname === 'openrouter.ai') {
          return { type: 'error', error: new Error('network down') };
        }
        return { type: 'error' };
      }, async () => {
        const models = await getAllModels(makeConfig({
          apiKeys: {
            nvidia: 'nvapi-test',
            openrouter: 'sk-or-test',
          },
        }));

        assert.ok(models.length > 20, 'expected hardcoded NVIDIA fallback list');
        assert.equal(models.some((m) => m.providerKey === 'openrouter'), false);
        assert.ok(models.some((m) => m.id === 'meta/llama-3.1-8b-instruct'));
      });
    });
  });
});
