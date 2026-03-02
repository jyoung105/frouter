import test from "node:test";
import assert from "node:assert/strict";
import { createHttpServer } from "../helpers/mock-http.js";
import { pingAllOnce } from "../../lib/ping.js";
import { PROVIDERS_META } from "../../lib/config.js";
import { assertModelMetricsInvariant } from "../../lib/utils.js";

const modelCount = Number(process.env.PERF_MODEL_COUNT ?? "40");
const rounds = Number(process.env.PERF_MEMORY_ROUNDS ?? "140");
const absHeapDeltaCeilingMb = Number(
  process.env.PERF_MEMORY_ABS_HEAP_DELTA_MB ?? "3",
);

function makeFixtureModels(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `demo/model-${i}`,
    providerKey: "nvidia",
    tier: "A",
    pings: [],
    status: "pending",
    httpCode: null,
  }));
}

test("perf: memory stays within long-run heap delta ceiling", async (t) => {
  if (typeof global.gc !== "function") {
    t.skip("global.gc unavailable; run perf with node --expose-gc");
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

    global.gc();
    const heapBefore = process.memoryUsage().heapUsed;

    for (let i = 0; i < rounds; i++) {
      await pingAllOnce(models, config);
    }

    global.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaMb = (heapAfter - heapBefore) / 1024 / 1024;

    assert.ok(
      heapDeltaMb <= absHeapDeltaCeilingMb,
      `heap delta exceeded: ${heapDeltaMb.toFixed(2)}MB > ${absHeapDeltaCeilingMb.toFixed(2)}MB (rounds=${rounds}, models=${modelCount})`,
    );

    for (const model of models) {
      assert.equal(model.pings.length <= 100, true);
      const canary = assertModelMetricsInvariant(model);
      assert.equal(canary.ok, true, canary.reason);
    }
  } finally {
    PROVIDERS_META.nvidia.chatUrl = originalChatUrl;
    await server.close();
  }
});
