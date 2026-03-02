import test from "node:test";
import assert from "node:assert/strict";
import { createHttpServer } from "../helpers/mock-http.js";
import {
  pingAllOnce,
  bumpPingEpoch,
  getPingEpoch,
} from "../../lib/ping.js";
import { PROVIDERS_META } from "../../lib/config.js";

test("pingAllOnce drops stale results from previous epoch", async () => {
  const server = await createHttpServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }, 80);
    });
  });

  const originalChatUrl = PROVIDERS_META.nvidia.chatUrl;
  PROVIDERS_META.nvidia.chatUrl = `${server.baseUrl}/chat/completions`;

  try {
    const model: any = {
      id: "demo/model-epoch",
      providerKey: "nvidia",
      tier: "A",
      pings: [],
      status: "pending",
      httpCode: null,
    };
    const config = {
      apiKeys: { nvidia: "nvapi-x" },
      providers: { nvidia: { enabled: true }, openrouter: { enabled: false } },
    };

    const promise = pingAllOnce([model], config);
    await new Promise((r) => setTimeout(r, 10));
    bumpPingEpoch();
    await promise;

    assert.equal(model.pings.length, 0);
    assert.equal(model._staleCommitDrops, 1);
  } finally {
    PROVIDERS_META.nvidia.chatUrl = originalChatUrl;
    await server.close();
  }
});

test("pingAllOnce drops duplicate sequence commits in the same epoch", async () => {
  const server = await createHttpServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  const originalChatUrl = PROVIDERS_META.nvidia.chatUrl;
  PROVIDERS_META.nvidia.chatUrl = `${server.baseUrl}/chat/completions`;

  try {
    const epoch = getPingEpoch();
    const model: any = {
      id: "demo/model-seq",
      providerKey: "nvidia",
      tier: "A",
      pings: [],
      status: "pending",
      httpCode: null,
      _seqEpoch: epoch,
      _nextSeq: 4,
      _lastCommitEpoch: epoch,
      _lastCommitSeq: 5,
    };
    const config = {
      apiKeys: { nvidia: "nvapi-x" },
      providers: { nvidia: { enabled: true }, openrouter: { enabled: false } },
    };

    await pingAllOnce([model], config);

    assert.equal(model.pings.length, 0);
    assert.equal(model._staleCommitDrops, 1);
  } finally {
    PROVIDERS_META.nvidia.chatUrl = originalChatUrl;
    await server.close();
  }
});
