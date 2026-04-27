import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { performance } from "node:perf_hooks";
import { createHttpServer } from "../helpers/mock-http.js";
import { PROVIDERS_META } from "../../lib/config.js";
import { pingAllOnce as pingAllOnceImpl } from "../../lib/ping.js";
const pingAllOnce = pingAllOnceImpl as (
  models: any[],
  config: any,
) => Promise<void>;

function makePendingModels(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `demo/model-${i}`,
    providerKey: "nvidia",
    pings: [] as any[],
    status: "pending",
    httpCode: null as string | null,
  }));
}

const testConfig = {
  apiKeys: { nvidia: "nvapi-test" },
  providers: {
    nvidia: { enabled: true },
    openrouter: { enabled: false },
  },
} as any;

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
    assert.equal(
      models.every((m) => m.status !== "pending"),
      true,
    );
    assert.equal(
      models.every((m) => m.httpCode === "000"),
      true,
    );
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

test("pingAllOnce maps HTTP 403 to forbidden status", async () => {
  const server = await createHttpServer((req, res) => {
    req.resume();
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden" }));
  });

  const originalChatUrl = PROVIDERS_META.nvidia.chatUrl;
  PROVIDERS_META.nvidia.chatUrl = `${server.baseUrl}/chat/completions`;

  try {
    const models = makePendingModels(1);
    await pingAllOnce(models, testConfig);
    assert.equal(models[0].status, "forbidden");
    assert.equal(models[0].httpCode, "403");
  } finally {
    PROVIDERS_META.nvidia.chatUrl = originalChatUrl;
    await server.close();
  }
});

test("pingAllOnce maps HTTP 500 to down status", async () => {
  const server = await createHttpServer((req, res) => {
    req.resume();
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal Server Error" }));
  });

  const originalChatUrl = PROVIDERS_META.nvidia.chatUrl;
  PROVIDERS_META.nvidia.chatUrl = `${server.baseUrl}/chat/completions`;

  try {
    const models = makePendingModels(1);
    await pingAllOnce(models, testConfig);
    assert.equal(models[0].status, "down");
    assert.equal(models[0].httpCode, "500");
  } finally {
    PROVIDERS_META.nvidia.chatUrl = originalChatUrl;
    await server.close();
  }
});

test("pingAllOnce maps HTTP 502 to down status", async () => {
  const server = await createHttpServer((req, res) => {
    req.resume();
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Bad Gateway" }));
  });

  const originalChatUrl = PROVIDERS_META.nvidia.chatUrl;
  PROVIDERS_META.nvidia.chatUrl = `${server.baseUrl}/chat/completions`;

  try {
    const models = makePendingModels(1);
    await pingAllOnce(models, testConfig);
    assert.equal(models[0].status, "down");
    assert.equal(models[0].httpCode, "502");
  } finally {
    PROVIDERS_META.nvidia.chatUrl = originalChatUrl;
    await server.close();
  }
});
