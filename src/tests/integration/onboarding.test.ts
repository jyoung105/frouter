import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT_DIR } from "../helpers/test-paths.js";
import { cleanupTempHome, makeTempHome } from "../helpers/temp-home.js";
import { runNode } from "../helpers/spawn-cli.js";

function prepareFakeBrowserLauncher(homePath: string) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "linux"
        ? "xdg-open"
        : null;

  if (!cmd) return null;

  const binDir = join(homePath, "fake-bin");
  const logPath = join(homePath, "fake-browser.log");
  mkdirSync(binDir, { recursive: true });

  const launcher = join(binDir, cmd);
  writeFileSync(
    launcher,
    `#!/bin/sh
echo "$@" >> "${logPath}"
exit 0
`,
    { mode: 0o755 },
  );

  return { binDir, logPath };
}

const configModuleUrl = pathToFileURL(join(ROOT_DIR, "lib", "config.js")).href;
const WIZARD_SCRIPT = `
import { loadConfig, runFirstRunWizard } from ${JSON.stringify(configModuleUrl)};

if (typeof process.stdin.setRawMode !== 'function') process.stdin.setRawMode = () => {};
try {
  Object.defineProperty(process.stdin, 'isRaw', { value: false, writable: true, configurable: true });
} catch {}

const cfg = loadConfig();
await runFirstRunWizard(cfg);
`;

function buildInputChunks(sequence: string, firstDelayMs = 700, stepMs = 120) {
  const chars = [...sequence];
  let delayMs = firstDelayMs;
  return chars.map((ch) => {
    const chunk = { delayMs, data: ch };
    delayMs += stepMs;
    return chunk;
  });
}

async function runWizard({
  home,
  inputChunks,
  env = {} as NodeJS.ProcessEnv,
}: {
  home: string;
  inputChunks: { delayMs: number; data: string }[];
  env?: NodeJS.ProcessEnv;
}) {
  return runNode(["--input-type=module", "-e", WIZARD_SCRIPT], {
    cwd: ROOT_DIR,
    env: { HOME: home, ...env },
    inputChunks,
    timeoutMs: 15_000,
  });
}

test("first-run onboarding rejects invalid key prefix and does not persist malformed key", async () => {
  const home = makeTempHome();
  try {
    const fakeBrowser = prepareFakeBrowserLauncher(home);
    const env: NodeJS.ProcessEnv = {};
    if (fakeBrowser) {
      env.PATH = `${fakeBrowser.binDir}:${process.env.PATH ?? ""}`;
    }

    const result = await runWizard({
      home,
      env,
      inputChunks: buildInputChunks("y\rbadkey\r\x1b\x1b"),
    });

    assert.equal(result.code, 0);
    assert.match(
      result.stdout,
      /https:\/\/build\.nvidia\.com\/settings\/api-key/,
    );
    assert.match(result.stdout, /Expected prefix "nvapi-"/);
    assert.match(result.stdout, /0 key\(s\) saved/);

    const cfg = JSON.parse(readFileSync(join(home, ".frouter.json"), "utf8"));
    assert.equal(cfg.apiKeys.nvidia, undefined);
    assert.equal(cfg.apiKeys.openrouter, undefined);

    if (fakeBrowser) {
      const browserLog = readFileSync(fakeBrowser.logPath, "utf8");
      assert.match(
        browserLog,
        /https:\/\/build\.nvidia\.com\/settings\/api-key/,
      );
    }
  } finally {
    cleanupTempHome(home);
  }
});

test("onboarding edge case: ESC on both providers saves zero keys", async () => {
  const home = makeTempHome();
  try {
    const result = await runWizard({
      home,
      inputChunks: buildInputChunks("\x1b\x1b"),
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /0 key\(s\) saved/);
    const cfg = JSON.parse(readFileSync(join(home, ".frouter.json"), "utf8"));
    assert.deepEqual(cfg.apiKeys, {});
  } finally {
    cleanupTempHome(home);
  }
});

test("onboarding error scenario: browser open failure is non-fatal", async () => {
  const home = makeTempHome();
  try {
    // Clear PATH so `open`/`xdg-open` cannot be found by execSync().
    const result = await runWizard({
      home,
      env: { PATH: "" },
      inputChunks: buildInputChunks("y\rnvapi-demo\r\x1b"),
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /browser opened|Paste NVIDIA NIM key/);
    const cfg = JSON.parse(readFileSync(join(home, ".frouter.json"), "utf8"));
    assert.equal(cfg.apiKeys.nvidia, "nvapi-demo");
  } finally {
    cleanupTempHome(home);
  }
});
