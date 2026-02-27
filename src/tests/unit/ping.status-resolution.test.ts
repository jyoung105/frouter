import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { performance } from "node:perf_hooks";
import { createHttpServer } from "../helpers/mock-http.js";
import { PROVIDERS_META } from "../../lib/config.js";
import { pingAllOnce } from "../../lib/ping.js";

function makePendingModels(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `demo/model-${i}`,
    providerKey: "nvidia",
    pings: [],
    status: "pending",
    httpCode: null,
  }));
}

const testConfig = {
  apiKeys: { nvidia: "nvapi-test" },
  providers: {
    nvidia: { enabled: true },
    openrouter: { enabled: false },
  },
};

test("pingAllOnce resolves first-pass pending statuses quickly", async () => {
  const server = await createHttpServer((req) => {
    req.resume();
    // Intentionally never respond; each ping should settle via timeout.
  });

  const originalChatUrl = PROVIDERS_META.nvidia.chatUrl;
  PROVIDERS_META.nvidia.chatUrl = `${server.baseUrl}/chat/completions`;

  try {
    const models = makePendingModels(45);
    const t0 = performance.now();
    await pingAllOnce(models, testConfig);
    const elapsedMs = performance.now() - t0;

    assert.ok(
      elapsedMs < 7_000,
      `expected fast first-pass status resolution, got ${elapsedMs.toFixed(1)}ms`,
    );
    assert.equal(models.every((m) => m.status !== "pending"), true);
    assert.equal(models.every((m) => m.httpCode === "000"), true);
  } finally {
    PROVIDERS_META.nvidia.chatUrl = originalChatUrl;
    await server.close();
  }
});

test("pingAllOnce keeps longer timeout behavior for already-probed models", async () => {
  const server = await createHttpServer((req, res) => {
    req.resume();
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    }, 3_200);
  });

  const originalChatUrl = PROVIDERS_META.nvidia.chatUrl;
  PROVIDERS_META.nvidia.chatUrl = `${server.baseUrl}/chat/completions`;

  try {
    const models = [
      {
        id: "demo/known-model",
        providerKey: "nvidia",
        pings: [{ code: "200", ms: 120 }],
        status: "up",
        httpCode: "200",
      },
    ];

    const t0 = performance.now();
    await pingAllOnce(models, testConfig);
    const elapsedMs = performance.now() - t0;

    assert.ok(
      elapsedMs >= 3_000,
      `expected steady-state probe to wait for slower response, got ${elapsedMs.toFixed(1)}ms`,
    );
    assert.equal(models[0].pings.at(-1)?.code, "200");
    assert.equal(models[0].status, "up");
  } finally {
    PROVIDERS_META.nvidia.chatUrl = originalChatUrl;
    await server.close();
  }
});

test("pingAllOnce converts pending models to down on connection errors", async () => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const addr = probe.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  await new Promise<void>((resolve, reject) =>
    probe.close((err) => (err ? reject(err) : resolve())),
  );

  const originalChatUrl = PROVIDERS_META.nvidia.chatUrl;
  PROVIDERS_META.nvidia.chatUrl = `http://127.0.0.1:${port}/chat/completions`;

  try {
    const models = makePendingModels(5);
    await pingAllOnce(models, testConfig);

    for (const model of models) {
      assert.equal(model.status, "down");
      assert.equal(model.httpCode, "ERR");
      assert.equal(model.pings.length, 1);
    }
  } finally {
    PROVIDERS_META.nvidia.chatUrl = originalChatUrl;
  }
});
