import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runInPty, stripAnsi } from "../helpers/run-pty.js";
import { ROOT_DIR } from "../helpers/test-paths.js";
import { BIN_PATH } from "../helpers/test-paths.js";
import {
  cleanupTempHome,
  defaultConfig,
  makeTempHome,
  writeHomeConfig,
} from "../helpers/temp-home.js";
import { runNode } from "../helpers/spawn-cli.js";

async function waitForFile(path, timeoutMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return existsSync(path);
}

test("direct target writers preserve selected provider/model IDs", async () => {
  const home = makeTempHome();
  try {
    const targetsUrl = pathToFileURL(join(ROOT_DIR, "lib", "targets.js")).href;
    const script = `
import { writeOpenCode, writeOpenClaw } from ${JSON.stringify(targetsUrl)};

const nimModel = { id: 'meta/llama-3.1-8b-instruct' };
const orModel = { id: 'mistralai/mistral-small-3.2-24b-instruct:free' };

writeOpenCode(nimModel, 'nvidia');
writeOpenClaw(nimModel, 'nvidia', 'nvapi-demo');

writeOpenCode(orModel, 'openrouter', 'sk-or-demo');
writeOpenClaw(orModel, 'openrouter', 'sk-or-demo');
`;

    const result = await runNode(["--input-type=module", "-e", script], {
      cwd: ROOT_DIR,
      env: { HOME: home },
    });

    assert.equal(result.code, 0);

    const openCode = readFileSync(
      join(home, ".config", "opencode", "opencode.json"),
      "utf8",
    );
    const openClaw = readFileSync(
      join(home, ".openclaw", "openclaw.json"),
      "utf8",
    );

    assert.match(
      openCode,
      /"model": "openrouter\/mistralai\/mistral-small-3.2-24b-instruct:free"/,
    );
    assert.match(openCode, /"apiKey": "\{env:OPENROUTER_API_KEY\}"/);
    assert.match(
      openClaw,
      /"primary": "openrouter\/mistralai\/mistral-small-3.2-24b-instruct:free"/,
    );
    assert.doesNotMatch(openClaw, /"OPENROUTER_API_KEY":/);
  } finally {
    cleanupTempHome(home);
  }
});

const SKIP = process.platform === "win32";

test(
  "interactive target picker confirm path (Enter) invokes opencode",
  { skip: SKIP && "PTY harness uses `script`, unavailable on Windows" },
  async () => {
    const home = makeTempHome();
    try {
      writeHomeConfig(
        home,
        defaultConfig({
          apiKeys: { nvidia: "nvapi-test" },
          providers: {
            nvidia: { enabled: true },
            openrouter: { enabled: false },
          },
        }),
      );

      const fakeBin = join(home, "fake-bin");
      const marker = join(home, "opencode-launched.log");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(
        join(fakeBin, "opencode"),
        `#!/bin/sh
cfg="$HOME/.config/opencode/opencode.json"
if [ ! -f "$cfg" ]; then
  echo "missing-config" >> "${marker}"
  exit 1
fi
if [ "$NVIDIA_API_KEY" != "nvapi-test" ]; then
  echo "missing-env" >> "${marker}"
  exit 1
fi
if [ "$OPENCODE_CLI_RUN_MODE" != "true" ]; then
  echo "missing-cli-run-mode" >> "${marker}"
  exit 1
fi
if grep -q '"model": "nvidia/' "$cfg"; then
  echo "launched" >> "${marker}"
  exit 0
fi
echo "bad-config" >> "${marker}"
exit 0
`,
        { mode: 0o755 },
      );

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
        inputChunks: [
          { delayMs: 850, data: "\r" }, // select highlighted model -> target screen
          { delayMs: 1600, data: "\r" }, // select target OpenCode (default first option)
          { delayMs: 2100, data: "\r" }, // select "Save + Launch" (default first option)
        ],
        timeoutMs: 15_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      assert.equal(await waitForFile(marker), true);
      const markerOut = readFileSync(marker, "utf8");
      assert.match(markerOut, /launched/);
      assert.doesNotMatch(markerOut, /missing-env/);
      assert.doesNotMatch(markerOut, /missing-cli-run-mode/);
      const openCodePath = join(home, ".config", "opencode", "opencode.json");
      assert.equal(existsSync(openCodePath), true);
      const openCode = readFileSync(openCodePath, "utf8");
      assert.match(openCode, /"model": "nvidia\//);
      const text = stripAnsi(result.stdout);
      assert.doesNotMatch(text, /OpenCode auth uses NVIDIA_API_KEY/);
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "interactive target picker shows OpenClaw as disabled and does not launch it",
  { skip: SKIP && "PTY harness uses `script`, unavailable on Windows" },
  async () => {
    const home = makeTempHome();
    try {
      writeHomeConfig(
        home,
        defaultConfig({
          apiKeys: { nvidia: "nvapi-test" },
          providers: {
            nvidia: { enabled: true },
            openrouter: { enabled: false },
          },
        }),
      );

      const fakeBin = join(home, "fake-bin");
      const marker = join(home, "openclaw-launched.log");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(
        join(fakeBin, "openclaw"),
        `#!/bin/sh
cfg="$HOME/.openclaw/openclaw.json"
if [ ! -f "$cfg" ]; then
  echo "missing-config" >> "${marker}"
  exit 1
fi
if grep -q '"primary": "nvidia/' "$cfg"; then
  echo "launched" >> "${marker}"
  exit 0
fi
echo "bad-config" >> "${marker}"
exit 0
`,
        { mode: 0o755 },
      );

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
        inputChunks: [
          { delayMs: 850, data: "\r" }, // model -> target screen
          { delayMs: 1600, data: "\x1b[B" }, // move to OpenClaw
          { delayMs: 1900, data: "\r" }, // select disabled target (shows warning, stays on selectTarget)
          { delayMs: 2400, data: "\x1b" }, // ESC to exit target picker
          { delayMs: 3000, data: "q" }, // quit app
        ],
        timeoutMs: 15_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      assert.equal(await waitForFile(marker, 350), false);
      const openClawPath = join(home, ".openclaw", "openclaw.json");
      assert.equal(existsSync(openClawPath), false);

      const text = stripAnsi(result.stdout);
      assert.match(text, /OpenClaw\s+\[disabled\]/);
      assert.match(text, /OpenClaw is currently disabled/);
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "interactive target picker save-only path (S key) writes config without launching target",
  { skip: SKIP && "PTY harness uses `script`, unavailable on Windows" },
  async () => {
    const home = makeTempHome();
    try {
      writeHomeConfig(
        home,
        defaultConfig({
          apiKeys: { nvidia: "nvapi-test" },
          providers: {
            nvidia: { enabled: true },
            openrouter: { enabled: false },
          },
        }),
      );

      const fakeBin = join(home, "fake-bin");
      const marker = join(home, "opencode-launched.log");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(
        join(fakeBin, "opencode"),
        `#!/bin/sh
echo "launched" >> "${marker}"
exit 0
`,
        { mode: 0o755 },
      );

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
        inputChunks: [
          { delayMs: 1200, data: "\r" }, // model -> target screen
          { delayMs: 3000, data: "\r" }, // select target OpenCode
          { delayMs: 4000, data: "\x1b[B" }, // move to "Save only"
          { delayMs: 4500, data: "\r" }, // confirm save-only
          { delayMs: 6500, data: "q" }, // back on main screen, quit
        ],
        timeoutMs: 15_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const openCodePath = join(home, ".config", "opencode", "opencode.json");
      assert.equal(existsSync(openCodePath), true);
      assert.equal(existsSync(marker), false);
      assert.match(readFileSync(openCodePath, "utf8"), /"model": "nvidia\//);
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "interactive target launch asks confirmation when fallback provider key is missing and declines launch on 'n'",
  { skip: SKIP && "PTY harness uses `script`, unavailable on Windows" },
  async () => {
    const home = makeTempHome();
    try {
      writeHomeConfig(
        home,
        defaultConfig({
          apiKeys: { nvidia: "nvapi-test" },
          providers: {
            nvidia: { enabled: true },
            openrouter: { enabled: true },
          },
        }),
      );

      const fakeBin = join(home, "fake-bin");
      const marker = join(home, "opencode-launched.log");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(
        join(fakeBin, "opencode"),
        `#!/bin/sh
echo "launched" >> "${marker}"
exit 0
`,
        { mode: 0o755 },
      );

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          FROUTER_NO_FETCH: "1",
          NVIDIA_API_KEY: "",
          OPENROUTER_API_KEY: "",
        },
        inputChunks: [
          { delayMs: 900, data: "\x1b[B".repeat(9) }, // select stepfun-ai/step-3.5-flash
          { delayMs: 1500, data: "\r" }, // model -> target screen
          { delayMs: 3500, data: "\r" }, // select target
          { delayMs: 4500, data: "\r" }, // select "Save + Launch"
          { delayMs: 6500, data: "\x1b" }, // ESC to decline add-key prompt
          { delayMs: 8000, data: "q" }, // quit app
        ],
        timeoutMs: 15_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);
      assert.equal(existsSync(marker), false);
    } finally {
      cleanupTempHome(home);
    }
  },
);
