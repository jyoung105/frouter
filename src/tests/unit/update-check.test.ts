import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHttpServer } from "../helpers/mock-http.js";
import { BIN_PATH, ROOT_DIR } from "../helpers/test-paths.js";
import {
  cleanupTempHome,
  defaultConfig,
  makeTempHome,
  writeHomeConfig,
} from "../helpers/temp-home.js";
import { runNode } from "../helpers/spawn-cli.js";

const PKG_VERSION = JSON.parse(
  readFileSync(join(ROOT_DIR, "..", "package.json"), "utf8"),
).version;

function makeConfig(home: string) {
  writeHomeConfig(home, defaultConfig({ apiKeys: { nvidia: "nvapi-test" } }));
}

test("update check: skips silently when version matches", async () => {
  const server = await createHttpServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: PKG_VERSION }));
  });

  const home = makeTempHome();
  try {
    makeConfig(home);
    const result = await runNode([BIN_PATH], {
      cwd: ROOT_DIR,
      env: {
        HOME: home,
        FREE_ROUTER_REGISTRY_URL: `${server.baseUrl}/free-router/latest`,
      },
      timeoutMs: 7_000,
    });

    assert.doesNotMatch(result.stdout + result.stderr, /Update available/);
  } finally {
    cleanupTempHome(home);
    await server.close();
  }
});

test("update check: skips silently when registry version is older", async () => {
  const server = await createHttpServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: "0.0.1" }));
  });

  const home = makeTempHome();
  try {
    makeConfig(home);
    const result = await runNode([BIN_PATH], {
      cwd: ROOT_DIR,
      env: {
        HOME: home,
        FREE_ROUTER_REGISTRY_URL: `${server.baseUrl}/free-router/latest`,
      },
      timeoutMs: 7_000,
    });

    assert.doesNotMatch(result.stdout + result.stderr, /Update available/);
  } finally {
    cleanupTempHome(home);
    await server.close();
  }
});

test("update check: shows update available in non-TTY and auto-skips", async () => {
  const server = await createHttpServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: "99.0.0" }));
  });

  const home = makeTempHome();
  try {
    makeConfig(home);
    const result = await runNode([BIN_PATH], {
      cwd: ROOT_DIR,
      env: {
        HOME: home,
        FREE_ROUTER_REGISTRY_URL: `${server.baseUrl}/free-router/latest`,
      },
      timeoutMs: 7_000,
    });

    const combined = result.stdout + result.stderr;
    // Should show update available message
    assert.match(combined, /Update available/);
    assert.match(combined, /99\.0\.0/);
    // In non-TTY, promptYesNo auto-returns false → falls through to TTY check
    assert.match(combined, /requires an interactive terminal/i);
  } finally {
    cleanupTempHome(home);
    await server.close();
  }
});

test("update check: silently continues when registry is unreachable", async () => {
  const home = makeTempHome();
  try {
    makeConfig(home);
    const result = await runNode([BIN_PATH], {
      cwd: ROOT_DIR,
      env: {
        HOME: home,
        FREE_ROUTER_REGISTRY_URL: "http://127.0.0.1:1/free-router/latest",
      },
      timeoutMs: 7_000,
    });

    assert.doesNotMatch(result.stdout + result.stderr, /Update available/);
    assert.match(result.stderr, /requires an interactive terminal/i);
  } finally {
    cleanupTempHome(home);
  }
});

test("update check: silently continues when registry returns invalid JSON", async () => {
  const server = await createHttpServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("not json at all");
  });

  const home = makeTempHome();
  try {
    makeConfig(home);
    const result = await runNode([BIN_PATH], {
      cwd: ROOT_DIR,
      env: {
        HOME: home,
        FREE_ROUTER_REGISTRY_URL: `${server.baseUrl}/free-router/latest`,
      },
      timeoutMs: 7_000,
    });

    assert.doesNotMatch(result.stdout + result.stderr, /Update available/);
    assert.match(result.stderr, /requires an interactive terminal/i);
  } finally {
    cleanupTempHome(home);
    await server.close();
  }
});

test("update check: FREE_ROUTER_SKIP_UPDATE_ONCE suppresses update check entirely", async () => {
  const server = await createHttpServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: "99.0.0" }));
  });

  const home = makeTempHome();
  try {
    makeConfig(home);
    const result = await runNode([BIN_PATH], {
      cwd: ROOT_DIR,
      env: {
        HOME: home,
        FREE_ROUTER_REGISTRY_URL: `${server.baseUrl}/free-router/latest`,
        FREE_ROUTER_SKIP_UPDATE_ONCE: "1",
      },
      timeoutMs: 7_000,
    });

    assert.doesNotMatch(result.stdout + result.stderr, /Update available/);
  } finally {
    cleanupTempHome(home);
    await server.close();
  }
});

test("update check: --best mode does not prompt for updates", async () => {
  const server = await createHttpServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: "99.0.0" }));
  });

  const home = makeTempHome();
  try {
    makeConfig(home);
    const result = await runNode([BIN_PATH, "--best"], {
      cwd: ROOT_DIR,
      env: {
        HOME: home,
        FREE_ROUTER_REGISTRY_URL: `${server.baseUrl}/free-router/latest`,
      },
      timeoutMs: 15_000,
    });

    assert.doesNotMatch(result.stdout + result.stderr, /Update available/);
  } finally {
    cleanupTempHome(home);
    await server.close();
  }
});
