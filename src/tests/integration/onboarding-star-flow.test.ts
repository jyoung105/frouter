import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT_DIR } from "../helpers/test-paths.js";
import { cleanupTempHome, makeTempHome } from "../helpers/temp-home.js";
import { runNode } from "../helpers/spawn-cli.js";

const firstRunAppUrl = pathToFileURL(
  join(ROOT_DIR, "tui", "FirstRunApp.js"),
).href;
const configModuleUrl = pathToFileURL(join(ROOT_DIR, "lib", "config.js")).href;

const FIRST_RUN_SCRIPT = `
import React from "react";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { FirstRunApp } from ${JSON.stringify(firstRunAppUrl)};
import { PROVIDERS_META, validateProviderApiKey } from ${JSON.stringify(configModuleUrl)};

const browserLogPath = process.env.BROWSER_LOG_PATH;
if (browserLogPath && !existsSync(browserLogPath)) writeFileSync(browserLogPath, "");

const proxyStdin = new PassThrough();
proxyStdin.isTTY = true;
proxyStdin.setRawMode = () => {};
proxyStdin.ref = () => {};
proxyStdin.unref = () => {};

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  proxyStdin.write(chunk);
});
process.stdin.resume();

const instance = render(
  React.createElement(FirstRunApp, {
    providers: PROVIDERS_META,
    validateKey: validateProviderApiKey,
    openBrowser: (url) => {
      if (browserLogPath) appendFileSync(browserLogPath, url + "\\n");
    },
    onDone: (result) => {
      process.stdout.write("RESULT:" + JSON.stringify(result) + "\\n");
      instance.unmount();
      process.exit(0);
    },
  }),
  {
    stdin: proxyStdin,
    exitOnCtrlC: false,
  },
);
`;

function buildInputChunks(tokens: string[], startDelayMs = 300, stepMs = 120) {
  let delayMs = startDelayMs;
  return tokens.map((data) => {
    const chunk = { delayMs, data };
    delayMs += stepMs;
    return chunk;
  });
}

function extractResult(stdout: string) {
  const match = stdout.match(/RESULT:(\{.*\})/);
  assert.ok(match, `expected RESULT payload in stdout:\n${stdout}`);
  return JSON.parse(match[1]);
}

const DOWN = "\x1b[B";

test("FirstRunApp star yes opens GitHub repo URL", async () => {
  const home = makeTempHome();
  const browserLogPath = join(home, "browser.log");
  try {
    const result = await runNode(
      ["--input-type=module", "-e", FIRST_RUN_SCRIPT],
      {
        cwd: ROOT_DIR,
        env: { HOME: home, BROWSER_LOG_PATH: browserLogPath },
        inputChunks: [
          { delayMs: 300, data: "\r" },
          ...buildInputChunks([..."nvapi-demo", "\r"], 700, 120),
          { delayMs: 2400, data: DOWN },
          { delayMs: 2640, data: DOWN },
          { delayMs: 2880, data: DOWN },
          { delayMs: 3120, data: "\r" },
          { delayMs: 3900, data: "\r" },
        ],
        timeoutMs: 10_000,
      },
    );

    assert.equal(result.code, 0);
    const payload = extractResult(result.stdout);
    assert.equal(payload.starPromptHandled, true);
    assert.equal(payload.startupSearchRequested, true);
    assert.equal(payload.apiKeys.nvidia, "nvapi-demo");

    const browserLog = readFileSync(browserLogPath, "utf8");
    assert.match(browserLog, /https:\/\/build\.nvidia\.com\/settings\/api-key/);
    assert.match(browserLog, /https:\/\/github\.com\/jyoung105\/free-router/);
  } finally {
    cleanupTempHome(home);
  }
});

test("FirstRunApp star no does not open GitHub repo URL", async () => {
  const home = makeTempHome();
  const browserLogPath = join(home, "browser.log");
  try {
    const result = await runNode(
      ["--input-type=module", "-e", FIRST_RUN_SCRIPT],
      {
        cwd: ROOT_DIR,
        env: { HOME: home, BROWSER_LOG_PATH: browserLogPath },
        inputChunks: [
          { delayMs: 300, data: "\r" },
          ...buildInputChunks([..."nvapi-demo", "\r"], 700, 120),
          { delayMs: 2400, data: DOWN },
          { delayMs: 2640, data: DOWN },
          { delayMs: 2880, data: DOWN },
          { delayMs: 3120, data: "\r" },
          { delayMs: 3900, data: DOWN },
          { delayMs: 4140, data: "\r" },
        ],
        timeoutMs: 10_000,
      },
    );

    assert.equal(result.code, 0);
    const payload = extractResult(result.stdout);
    assert.equal(payload.starPromptHandled, true);
    assert.equal(payload.startupSearchRequested, false);
    assert.equal(payload.apiKeys.nvidia, "nvapi-demo");

    const browserLog = existsSync(browserLogPath)
      ? readFileSync(browserLogPath, "utf8")
      : "";
    assert.match(browserLog, /https:\/\/build\.nvidia\.com\/settings\/api-key/);
    assert.doesNotMatch(
      browserLog,
      /https:\/\/github\.com\/jyoung105\/free-router/,
    );
  } finally {
    cleanupTempHome(home);
  }
});
