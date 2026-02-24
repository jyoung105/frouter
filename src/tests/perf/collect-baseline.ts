import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { runNode } from '../helpers/spawn-cli.js';
import { BIN_PATH, ROOT_DIR } from '../helpers/test-paths.js';
import { createHttpServer } from '../helpers/mock-http.js';
import { pingAllOnce } from '../../lib/ping.js';
import { PROVIDERS_META } from '../../lib/config.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(__dir, 'baseline.json');

const STARTUP_RUNS = Number(process.env.PERF_STARTUP_RUNS ?? '5');
const PING_RUNS = Number(process.env.PERF_PING_RUNS ?? '5');
const MODEL_COUNT = Number(process.env.PERF_MODEL_COUNT ?? '40');

function makeFixtureModels(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `demo/model-${i}`,
    providerKey: 'nvidia',
    pings: [],
    status: 'pending',
    httpCode: null,
  }));
}

async function measureStartupMs(): Promise<number> {
  let total = 0;

  for (let i = 0; i < STARTUP_RUNS; i++) {
    const t0 = performance.now();
    const result = await runNode([BIN_PATH, '--help'], { cwd: ROOT_DIR, timeoutMs: 15_000 });
    if (result.code !== 0) {
      throw new Error(`startup run failed (exit=${result.code}): ${result.stderr || result.stdout}`);
    }
    total += performance.now() - t0;
  }

  return total / STARTUP_RUNS;
}

async function measurePingMs(): Promise<number> {
  const server = await createHttpServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  const originalChatUrl = PROVIDERS_META.nvidia.chatUrl;
  PROVIDERS_META.nvidia.chatUrl = `${server.baseUrl}/chat/completions`;

  const config = {
    apiKeys: { nvidia: 'nvapi-perf' },
    providers: {
      nvidia: { enabled: true },
      openrouter: { enabled: false },
    },
  };

  try {
    const models = makeFixtureModels(MODEL_COUNT);
    await pingAllOnce(models, config); // warm-up

    let total = 0;
    for (let i = 0; i < PING_RUNS; i++) {
      const t0 = performance.now();
      await pingAllOnce(models, config);
      total += performance.now() - t0;
    }

    return total / PING_RUNS;
  } finally {
    PROVIDERS_META.nvidia.chatUrl = originalChatUrl;
    await server.close();
  }
}

async function main() {
  const startupMs = Number((await measureStartupMs()).toFixed(2));
  const pingMs = Number((await measurePingMs()).toFixed(2));

  const prev = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : null;

  const next = {
    generatedAt: new Date().toISOString(),
    startupMs,
    pingMs,
    modelCount: MODEL_COUNT,
    startupRuns: STARTUP_RUNS,
    pingRuns: PING_RUNS,
  };

  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');

  console.log(`Wrote ${BASELINE_PATH}`);
  console.log(next);

  if (prev) {
    console.log('Previous baseline:', prev);
  }

  console.log(`\nYou can override these values with env vars:`);
  console.log(`  BASELINE_STARTUP_MS=${startupMs}`);
  console.log(`  BASELINE_PING_MS=${pingMs}`);
}

main().catch((err) => {
  console.error('Failed to collect perf baseline:', err);
  process.exit(1);
});
