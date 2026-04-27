import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT_DIR } from "../helpers/test-paths.js";
import { cleanupTempHome, makeTempHome } from "../helpers/temp-home.js";
import { runNode } from "../helpers/spawn-cli.js";

const configModuleUrl = pathToFileURL(join(ROOT_DIR, "lib", "config.js")).href;

const WIZARD_SCRIPT = `
import { PassThrough } from "node:stream";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { loadConfig, runFirstRunWizard } from ${JSON.stringify(configModuleUrl)};

const browserLogPath = process.env.BROWSER_LOG_PATH;
if (browserLogPath && !existsSync(browserLogPath)) writeFileSync(browserLogPath, "");

if (typeof process.stdin.setRawMode !== "function") process.stdin.setRawMode = () => {};
try {
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
} catch {}

const cfg = loadConfig();
const outcome = await runFirstRunWizard(cfg);
process.stdout.write("OUTCOME:" + JSON.stringify({
  apiKeys: outcome.config.apiKeys,
  starPromptHandled: outcome.starPromptHandled,
  startupSearchRequested: outcome.startupSearchRequested,
}) + "\\n");
process.exit(0);
`;

function buildInputChunks(
  tokens: string[],
  startDelayMs = 300,
  stepMs = 120,
) {
  let delayMs = startDelayMs;
  return tokens.map((data) => {
    const chunk = { delayMs, data };
    delayMs += stepMs;
    return chunk;
  });
}

function extractOutcome(stdout: string) {
  const match = stdout.match(/OUTCOME:(\{.*\})/);
  assert.ok(match, `expected OUTCOME payload in stdout:\n${stdout}`);
  return JSON.parse(match[1]);
}

const DOWN = "\x1b[B";

test("first-run wizard persists a valid key and reaches star prompt", async () => {
  const home = makeTempHome();
  const browserLogPath = join(home, "browser.log");
  writeFileSync(browserLogPath, "");
  try {
    const result = await runNode(
      ["--input-type=module", "-e", WIZARD_SCRIPT],
      {
        cwd: ROOT_DIR,
        env: { HOME: home, BROWSER_LOG_PATH: browserLogPath },
        inputChunks: [
          { delayMs: 400, data: "\r" },
          ...buildInputChunks([..."nvapi-demo", "\r"], 800, 120),
          { delayMs: 2600, data: DOWN },
          { delayMs: 2740, data: DOWN },
          { delayMs: 2880, data: "\r" },
          { delayMs: 3400, data: DOWN },
          { delayMs: 3540, data: "\r" },
        ],
        timeoutMs: 15_000,
      },
    );

    assert.equal(result.code, 0);
    const payload = extractOutcome(result.stdout);
    assert.equal(payload.apiKeys.nvidia, "nvapi-demo");
    assert.equal(payload.starPromptHandled, true);
    assert.equal(payload.startupSearchRequested, false);

    const cfg = JSON.parse(readFileSync(join(home, ".free-router.json"), "utf8"));
    assert.equal(cfg.apiKeys.nvidia, "nvapi-demo");
  } finally {
    cleanupTempHome(home);
  }
});

test("first-run wizard tolerates browser launch failure", async () => {
  const home = makeTempHome();
  try {
    const result = await runNode(
      ["--input-type=module", "-e", WIZARD_SCRIPT],
      {
        cwd: ROOT_DIR,
        env: { HOME: home, PATH: "" },
        inputChunks: [
          { delayMs: 400, data: "\r" },
          ...buildInputChunks([..."nvapi-demo", "\r"], 800, 120),
          { delayMs: 2600, data: DOWN },
          { delayMs: 2740, data: DOWN },
          { delayMs: 2880, data: "\r" },
          { delayMs: 3400, data: DOWN },
          { delayMs: 3540, data: "\r" },
        ],
        timeoutMs: 15_000,
      },
    );

    assert.equal(result.code, 0);
    const cfg = JSON.parse(readFileSync(join(home, ".free-router.json"), "utf8"));
    assert.equal(cfg.apiKeys.nvidia, "nvapi-demo");
    assert.ok(existsSync(join(home, ".free-router.json")));
  } finally {
    cleanupTempHome(home);
  }
});
