import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createHttpServer } from "../helpers/mock-http.js";
import { pingAllOnce } from "../../lib/ping.js";
import { PROVIDERS_META } from "../../lib/config.js";
import { assertModelMetricsInvariant } from "../../lib/utils.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const baselineFilePath = join(__dir, "baseline.json");
const ABS_PING_AVG_CEILING_MS = Number(
  process.env.PERF_PING_ABS_AVG_CEILING_MS ?? "6",
);
const ABS_PING_P95_CEILING_MS = Number(
  process.env.PERF_PING_ABS_P95_CEILING_MS ?? "8",
);
const WARMUP_RUNS = Number(process.env.PERF_PING_WARMUP_RUNS ?? "3");
const MEASURED_RUNS = Number(process.env.PERF_PING_MEASURED_RUNS ?? "30");

function resolveBaselinePingMs(): number {
  const fromEnv = Number(process.env.BASELINE_PING_MS ?? "0");
  if (fromEnv > 0 && !Number.isNaN(fromEnv)) return fromEnv;
  if (!existsSync(baselineFilePath)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(baselineFilePath, "utf8"));
    const fromFile = Number(parsed?.pingMs ?? "0");
    return Number.isNaN(fromFile) ? 0 : fromFile;
  } catch {
    return 0;
  }
}

const modelCount = Number(process.env.PERF_MODEL_COUNT ?? "40");

function makeFixtureModels(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `demo/model-${i}`,
    providerKey: "nvidia",
    pings: [],
    status: "pending",
    httpCode: null,
  }));
}

test("perf: pingAllOnce stays within absolute and baseline budgets", async () => {
  const baselinePingMs = resolveBaselinePingMs();

  const server = await createHttpServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  const originalChatUrl = PROVIDERS_META.nvidia.chatUrl;
  PROVIDERS_META.nvidia.chatUrl = `${server.baseUrl}/chat/completions`;

  const config = {
    apiKeys: { nvidia: "nvapi-perf" },
    providers: {
      nvidia: { enabled: true },
      openrouter: { enabled: false },
    },
  };

  try {
    const models = makeFixtureModels(modelCount);
    for (let i = 0; i < WARMUP_RUNS; i++) {
      await pingAllOnce(models, config);
    }

    const samples: number[] = [];
    for (let i = 0; i < MEASURED_RUNS; i++) {
      const t0 = performance.now();
      await pingAllOnce(models, config);
      samples.push(performance.now() - t0);
    }
    const avgMs = samples.reduce((sum, ms) => sum + ms, 0) / samples.length;
    const sorted = [...samples].sort((a, b) => a - b);
    const p95Ms = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];

    assert.ok(
      avgMs <= ABS_PING_AVG_CEILING_MS,
      `ping avg absolute ceiling exceeded: ${avgMs.toFixed(2)}ms > ${ABS_PING_AVG_CEILING_MS.toFixed(2)}ms`,
    );
    assert.ok(
      p95Ms <= ABS_PING_P95_CEILING_MS,
      `ping p95 absolute ceiling exceeded: ${p95Ms.toFixed(2)}ms > ${ABS_PING_P95_CEILING_MS.toFixed(2)}ms`,
    );

    if (baselinePingMs > 0 && Number.isFinite(baselinePingMs)) {
      const relativeBudgetMs = Math.max(baselinePingMs * 1.05, baselinePingMs + 5);
      assert.ok(
        avgMs <= relativeBudgetMs,
        `ping baseline regression: ${avgMs.toFixed(2)}ms > ${relativeBudgetMs.toFixed(2)}ms (baseline=${baselinePingMs}ms)`,
      );
    }

    for (const model of models) {
      const canary = assertModelMetricsInvariant(model);
      assert.equal(canary.ok, true, canary.reason);
    }
  } finally {
    PROVIDERS_META.nvidia.chatUrl = originalChatUrl;
    await server.close();
  }
});
