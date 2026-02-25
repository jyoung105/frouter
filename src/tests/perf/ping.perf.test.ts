import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createHttpServer } from "../helpers/mock-http.js";
import { pingAllOnce } from "../../lib/ping.js";
import { PROVIDERS_META } from "../../lib/config.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const baselineFilePath = join(__dir, "baseline.json");

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

test("perf: pingAllOnce regression <= 5% of baseline", async (t) => {
  const baselinePingMs = resolveBaselinePingMs();
  if (!baselinePingMs || Number.isNaN(baselinePingMs)) {
    t.skip("Set BASELINE_PING_MS or run `npm run perf:baseline` first.");
    return;
  }

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
    await pingAllOnce(models, config); // warm-up

    const t0 = performance.now();
    await pingAllOnce(models, config);
    const elapsedMs = performance.now() - t0;
    const budgetMs = Math.max(baselinePingMs * 1.05, baselinePingMs + 5);

    assert.ok(
      elapsedMs <= budgetMs,
      `ping regression: ${elapsedMs.toFixed(2)}ms > ${budgetMs.toFixed(2)}ms (baseline=${baselinePingMs}ms)`,
    );
  } finally {
    PROVIDERS_META.nvidia.chatUrl = originalChatUrl;
    await server.close();
  }
});
