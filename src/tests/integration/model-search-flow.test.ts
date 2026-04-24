import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInPty, stripAnsi } from "../helpers/run-pty.js";
import { BIN_PATH, ROOT_DIR } from "../helpers/test-paths.js";
import {
  cleanupTempHome,
  defaultConfig,
  makeTempHome,
  writeHomeConfig,
} from "../helpers/temp-home.js";

const SKIP = process.platform === "win32";

function getLatestFrame(rawOutput: string, needle: string) {
  const chunks = String(rawOutput).split("\x1b[2J\x1b[H");
  for (let i = chunks.length - 1; i >= 0; i--) {
    const frame = stripAnsi(chunks[i]);
    if (frame.includes(needle)) return frame;
  }
  return "";
}

function getLatestFrameRaw(rawOutput: string, needle: string) {
  const chunks = String(rawOutput).split("\x1b[2J\x1b[H");
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (stripAnsi(chunks[i]).includes(needle)) return chunks[i];
  }
  return "";
}

function buildInputChunks(tokens: string[], startDelayMs = 850, stepMs = 120) {
  let delayMs = startDelayMs;
  return tokens.map((data) => {
    const chunk = { delayMs, data };
    delayMs += stepMs;
    return chunk;
  });
}

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

test(
  "interactive model search flow (/, typing, backspace, ESC)",
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

      const sequence = [
        { delayMs: 850, data: "/" },
        { delayMs: 980, data: "l" },
        { delayMs: 1110, data: "l" },
        { delayMs: 1240, data: "a" },
        { delayMs: 1370, data: "m" },
        { delayMs: 1500, data: "a" },
        { delayMs: 1630, data: "\x7f" }, // backspace
        { delayMs: 1780, data: "\x1b" }, // exit search mode
        { delayMs: 1960, data: "q" }, // quit app
      ];

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: { HOME: home, FREE_ROUTER_NO_FETCH: "1" },
        inputChunks: sequence,
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const text = stripAnsi(result.stdout);
      assert.match(text, /\[Model Search\]/);
      assert.match(text, /\/llama_/); // search query while editing
      assert.match(text, /\/llam_/); // after backspace
      assert.match(text, /Press '\/' to search models/); // after ESC
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "interactive search error scenario: no matching model shows empty result count",
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

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: { HOME: home, FREE_ROUTER_NO_FETCH: "1" },
        inputChunks: [
          { delayMs: 850, data: "/" },
          { delayMs: 980, data: "z" },
          { delayMs: 1110, data: "z" },
          { delayMs: 1240, data: "z" },
          { delayMs: 1370, data: "z" },
          { delayMs: 1490, data: "\x1b[B" }, // down on empty results must stay stable
          { delayMs: 1600, data: "\x1b" }, // exit search mode first
          { delayMs: 1900, data: "q" },
        ],
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);
      const text = stripAnsi(result.stdout);
      assert.match(text, /\/zzzz_/);
      assert.match(text, /0\/\d+ models/);
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "entering search mode resets viewport so rank 1 is visible",
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

      const inputChunks = [];
      let delayMs = 850;
      for (let i = 0; i < 24; i++) {
        inputChunks.push({ delayMs, data: "j" });
        delayMs += 45;
      }
      inputChunks.push({ delayMs: delayMs + 160, data: "/" });
      inputChunks.push({ delayMs: delayMs + 420, data: "\x03" }); // Ctrl+C

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          FREE_ROUTER_NO_FETCH: "1",
          FREE_ROUTER_SKIP_UPDATE_ONCE: "1",
        },
        inputChunks,
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const frame = getLatestFrame(result.stdout, "/_");
      assert.ok(frame, "expected a rendered search frame");
      const lines = frame.split("\n");
      const headerIdx = lines.findIndex(
        (line) => line.includes("#") && line.includes("Model"),
      );
      assert.notEqual(headerIdx, -1);
      assert.match(frame, /███████╗/);
      const firstRankLine = lines
        .slice(headerIdx + 1)
        .find((line) => /^\s+\d+\s+/.test(line));
      assert.ok(firstRankLine, "expected first ranked row in search viewport");
      assert.match(firstRankLine || "", /^\s+1\s+/);
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "scrolling in search mode hides startup pixel title",
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

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: { HOME: home, FREE_ROUTER_NO_FETCH: "1" },
        inputChunks: [
          { delayMs: 850, data: "/" },
          { delayMs: 1050, data: "\x1b[B" },
          { delayMs: 1300, data: "\x03" }, // Ctrl+C
        ],
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const frameRaw = getLatestFrameRaw(result.stdout, "/_");
      assert.ok(frameRaw, "expected a rendered search frame after scroll");
      const frame = stripAnsi(frameRaw);
      assert.doesNotMatch(frame, /███████╗/);

      const selectedRaw = frameRaw
        .split("\n")
        .find((line) => line.includes("\x1b[48;5;235m"));
      assert.ok(selectedRaw, "expected selected row highlight after scroll");
      const selectedLine = stripAnsi(selectedRaw || "");
      assert.match(selectedLine, /^\s*2\s+/);
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "startup layout keeps headers visible when PTY reports unknown size",
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

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          FREE_ROUTER_NO_FETCH: "1",
          FREE_ROUTER_SKIP_UPDATE_ONCE: "1",
        },
        inputChunks: [{ delayMs: 900, data: "q" }],
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const frame = getLatestFrame(result.stdout, "[Model Search]");
      assert.ok(frame, "expected a rendered main screen frame");
      const lines = frame.split("\n").filter((line) => line !== "");
      const outputText = stripAnsi(result.stdout);

      assert.match(lines[0] || "", /\bfree-router\b/i);
      assert.match(lines[1] || "", /\[Model Search\]/);
      assert.match(lines[2] || "", /#\s+Tier\s+Provider\s+Model/);
      assert.match(outputText, /FREE-ROUTER · Free Model Router/);
      assert.ok(
        lines.some((line) => line.includes("↑↓/jk:nav")),
        "expected footer to remain visible",
      );
      assert.ok(
        lines.length <= 26,
        `expected compact viewport fallback (<=26 lines), got ${lines.length}`,
      );
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "main screen redraw uses cursor-home updates (no full clear flicker) by default",
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

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          FREE_ROUTER_NO_FETCH: "1",
          FREE_ROUTER_TUI_FORCE_CLEAR: "0",
        },
        inputChunks: [{ delayMs: 3200, data: "q" }],
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const clearCount = (result.stdout.match(/\x1b\[2J\x1b\[H/g) || []).length;
      const homeCount = (result.stdout.match(/\x1b\[H/g) || []).length;
      assert.equal(clearCount, 0);
      assert.ok(
        homeCount >= 2,
        `expected repeated cursor-home renders, got ${homeCount}`,
      );
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "returning from settings refresh keeps viewport anchored near top ranks",
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

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: { HOME: home, FREE_ROUTER_NO_FETCH: "1" },
        inputChunks: [
          { delayMs: 850, data: "j" },
          { delayMs: 980, data: "j" }, // rank 3 in top section
          { delayMs: 1200, data: "P" }, // open settings
          { delayMs: 1900, data: " " }, // nvidia off (wait for Ink mount)
          { delayMs: 2100, data: " " }, // nvidia on (simulated refresh trigger)
          { delayMs: 2400, data: "\x1b" }, // back to main -> refreshModels()
          { delayMs: 3800, data: "q" },
        ],
        timeoutMs: 15_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const rawFrame = getLatestFrameRaw(result.stdout, "[Model Search]");
      assert.ok(rawFrame, "expected a rendered main screen frame");

      const lines = stripAnsi(rawFrame)
        .split("\n")
        .filter((line) => line !== "");
      assert.match(lines[0] || "", /\bfree-router\b/i);
      assert.match(lines[1] || "", /\[Model Search\]/);
      assert.match(lines[2] || "", /#\s+Tier\s+Provider\s+Model/);

      const selectedRaw = rawFrame
        .split("\n")
        .find((line) => line.includes("\x1b[48;5;235m"));
      assert.ok(selectedRaw, "expected selected row highlight");
      const selectedLine = stripAnsi(selectedRaw || "");
      const rankMatch = /^\s*(\d+)\s+/.exec(selectedLine);
      assert.ok(rankMatch, `expected selected row rank, got: ${selectedLine}`);
      const selectedRank = Number.parseInt(rankMatch?.[1] || "0", 10);
      assert.ok(
        selectedRank <= 20,
        `expected selection to stay near top ranks after refresh, got rank ${selectedRank}`,
      );

      const wrappedNoise = lines.filter((line) => /^[A-Z]\s+\d/.test(line));
      assert.equal(
        wrappedNoise.length,
        0,
        `unexpected wrapped/noise lines: ${wrappedNoise.join(" | ")}`,
      );
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "model removal during refresh keeps selection near top and avoids viewport jump",
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

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          FREE_ROUTER_NO_FETCH: "1",
          FREE_ROUTER_SKIP_UPDATE_ONCE: "1",
          FREE_ROUTER_TEST_DROP_MODEL_AFTER_CALL:
            "2:nvidia/deepseek-ai/deepseek-v3.2",
        },
        inputChunks: [
          { delayMs: 850, data: "j" },
          { delayMs: 980, data: "j" }, // rank 3 while user is in top section
          { delayMs: 1200, data: "P" }, // open settings
          { delayMs: 1900, data: "\x1b" }, // back to main -> refreshModels() (wait for Ink mount)
          { delayMs: 3500, data: "q" },
        ],
        timeoutMs: 15_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const rawFrame = getLatestFrameRaw(result.stdout, "[Model Search]");
      assert.ok(rawFrame, "expected a rendered main screen frame");

      const lines = stripAnsi(rawFrame)
        .split("\n")
        .filter((line) => line !== "");
      assert.match(lines[0] || "", /\bfree-router\b/i);
      assert.match(lines[1] || "", /\[Model Search\]/);
      assert.match(lines[1] || "", /\d+\/\d+ mo/);
      assert.match(lines[2] || "", /#\s+Tier\s+Provider\s+Model/);

      const selectedRaw = rawFrame
        .split("\n")
        .find((line) => line.includes("\x1b[48;5;235m"));
      assert.ok(selectedRaw, "expected selected row highlight");
      const selectedLine = stripAnsi(selectedRaw || "");
      const rankMatch = /^\s*(\d+)\s+/.exec(selectedLine);
      assert.ok(rankMatch, `expected selected row rank, got: ${selectedLine}`);
      const selectedRank = Number.parseInt(rankMatch?.[1] || "0", 10);
      assert.ok(
        selectedRank <= 20,
        `expected selection to stay near top after model removal, got rank ${selectedRank}`,
      );

      const wrappedNoise = lines.filter((line) => /^[A-Z]\s+\d/.test(line));
      assert.equal(
        wrappedNoise.length,
        0,
        `unexpected wrapped/noise lines: ${wrappedNoise.join(" | ")}`,
      );
      assert.equal(rawFrame.includes("DeepSeek V3.2"), false);
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "pressing Enter in search mode opens opencode without terminal notices",
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
          FREE_ROUTER_NO_FETCH: "1",
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
        inputChunks: [
          { delayMs: 850, data: "/" },
          { delayMs: 980, data: "l" },
          { delayMs: 1110, data: "l" },
          { delayMs: 1240, data: "a" },
          { delayMs: 1370, data: "m" },
          { delayMs: 1500, data: "a" },
          { delayMs: 1700, data: "\r" }, // open opencode from search mode
        ],
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const openCodePath = join(home, ".config", "opencode", "opencode.json");
      const openClawPath = join(home, ".openclaw", "openclaw.json");
      assert.equal(existsSync(marker), true);
      assert.match(readFileSync(marker, "utf8"), /launched/);
      assert.equal(existsSync(openCodePath), true);
      assert.equal(existsSync(openClawPath), false);
      assert.match(
        readFileSync(openCodePath, "utf8"),
        /"model": "nvidia\/meta\/llama/i,
      );
      assert.match(
        readFileSync(openCodePath, "utf8"),
        /"apiKey": "\{env:NVIDIA_API_KEY\}"/,
      );

      const text = stripAnsi(result.stdout);
      assert.doesNotMatch(text, /OpenCode model set/);
      assert.doesNotMatch(text, /OpenCode config written/);
      assert.doesNotMatch(text, /OpenCode auth uses NVIDIA_API_KEY/);
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "main-tab quick API key flow adds a missing key",
  { skip: SKIP && "PTY harness uses `script`, unavailable on Windows" },
  async () => {
    const home = makeTempHome();
    try {
      writeHomeConfig(
        home,
        defaultConfig({
          apiKeys: { openrouter: "sk-or-test" },
          providers: {
            nvidia: { enabled: true },
            openrouter: { enabled: false },
          },
        }),
      );

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: { HOME: home, FREE_ROUTER_NO_FETCH: "1" },
        inputChunks: [
          { delayMs: 850, data: "a" },
          ...buildInputChunks(
            [..."nvapi-added-main-tab", "\r", "q", "q"],
            1500,
            120,
          ),
        ],
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const cfg = JSON.parse(readFileSync(join(home, ".free-router.json"), "utf8"));
      assert.equal(cfg.apiKeys.nvidia, "nvapi-added-main-tab");
      assert.equal(cfg.apiKeys.openrouter, "sk-or-test");
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "main-tab quick API key flow auto-opens signup page for missing provider key",
  { skip: SKIP && "PTY harness uses `script`, unavailable on Windows" },
  async () => {
    const home = makeTempHome();
    try {
      writeHomeConfig(
        home,
        defaultConfig({
          apiKeys: { openrouter: "sk-or-test" },
          providers: {
            nvidia: { enabled: true },
            openrouter: { enabled: false },
          },
        }),
      );

      const fakeBrowser = prepareFakeBrowserLauncher(home);
      const env: NodeJS.ProcessEnv = { HOME: home, FREE_ROUTER_NO_FETCH: "1" };
      if (fakeBrowser) {
        env.PATH = `${fakeBrowser.binDir}:${process.env.PATH ?? ""}`;
      }

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env,
        inputChunks: [
          { delayMs: 850, data: "a" },
          ...buildInputChunks(
            [..."nvapi-added-from-auto-open", "\r", "q", "q"],
            1500,
            120,
          ),
        ],
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const cfg = JSON.parse(readFileSync(join(home, ".free-router.json"), "utf8"));
      assert.equal(cfg.apiKeys.nvidia, "nvapi-added-from-auto-open");

      if (fakeBrowser) {
        const browserLog = readFileSync(fakeBrowser.logPath, "utf8");
        assert.match(
          browserLog,
          /https:\/\/build\.nvidia\.com\/settings\/api-keys/,
        );
      }
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "settings navigate mode auto-opens signup page for first provider with missing key",
  { skip: SKIP && "PTY harness uses `script`, unavailable on Windows" },
  async () => {
    const home = makeTempHome();
    try {
      writeHomeConfig(
        home,
        defaultConfig({
          apiKeys: { openrouter: "sk-or-test" },
          providers: {
            nvidia: { enabled: true },
            openrouter: { enabled: true },
          },
        }),
      );

      const fakeBrowser = prepareFakeBrowserLauncher(home);
      const env: NodeJS.ProcessEnv = { HOME: home, FREE_ROUTER_NO_FETCH: "1" };
      if (fakeBrowser) {
        env.PATH = `${fakeBrowser.binDir}:${process.env.PATH ?? ""}`;
      }

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env,
        inputChunks: [
          { delayMs: 850, data: "P" }, // open full settings screen
          { delayMs: 2300, data: "\x1b" }, // back to main
          { delayMs: 3200, data: "q" }, // quit app
        ],
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      if (fakeBrowser) {
        const browserLog = readFileSync(fakeBrowser.logPath, "utf8");
        assert.match(
          browserLog,
          /https:\/\/build\.nvidia\.com\/settings\/api-keys/,
        );
      }
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "settings navigate mode auto-opens signup page when moving to another missing-key provider",
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

      const fakeBrowser = prepareFakeBrowserLauncher(home);
      const env: NodeJS.ProcessEnv = { HOME: home, FREE_ROUTER_NO_FETCH: "1" };
      if (fakeBrowser) {
        env.PATH = `${fakeBrowser.binDir}:${process.env.PATH ?? ""}`;
      }

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env,
        inputChunks: [
          { delayMs: 850, data: "P" }, // open full settings screen
          { delayMs: 1900, data: "j" }, // move selection to OpenRouter (missing key)
          { delayMs: 2700, data: "\x1b" }, // back to main
          { delayMs: 3500, data: "q" }, // quit app
        ],
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      if (fakeBrowser) {
        const browserLog = readFileSync(fakeBrowser.logPath, "utf8");
        assert.match(browserLog, /https:\/\/openrouter\.ai\/settings\/keys/);
      }
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "main-tab quick API key flow changes an existing key",
  { skip: SKIP && "PTY harness uses `script`, unavailable on Windows" },
  async () => {
    const home = makeTempHome();
    try {
      writeHomeConfig(
        home,
        defaultConfig({
          apiKeys: { nvidia: "nvapi-old", openrouter: "sk-or-test" },
          providers: {
            nvidia: { enabled: true },
            openrouter: { enabled: false },
          },
        }),
      );

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: { HOME: home, FREE_ROUTER_NO_FETCH: "1" },
        inputChunks: [
          { delayMs: 850, data: "A" },
          ...buildInputChunks(
            [..."nvapi-new-main-tab", "\r", "q", "q"],
            1500,
            120,
          ),
        ],
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const cfg = JSON.parse(readFileSync(join(home, ".free-router.json"), "utf8"));
      assert.equal(cfg.apiKeys.nvidia, "nvapi-new-main-tab");
    } finally {
      cleanupTempHome(home);
    }
  },
);

// Skip on Linux CI: Ink subapp never renders in PTY when config has two API keys.
// Passes on macOS. Root cause is a Linux-specific PTY/Ink interaction; tracked separately.
(process.platform === "linux" ? test.skip : test)(
  "main-tab quick API key flow rejects invalid prefix and preserves previous key",
  { skip: SKIP && "PTY harness uses `script`, unavailable on Windows" },
  async () => {
    const home = makeTempHome();
    try {
      writeHomeConfig(
        home,
        defaultConfig({
          apiKeys: { nvidia: "nvapi-keep-me", openrouter: "sk-or-test" },
          providers: {
            nvidia: { enabled: true },
            openrouter: { enabled: false },
          },
        }),
      );

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          FREE_ROUTER_NO_FETCH: "1",
          FREE_ROUTER_SKIP_UPDATE_ONCE: "1",
        },
        inputChunks: [
          { delayMs: 2000, data: "a" },
          ...buildInputChunks(
            [..."bad-prefix", "\r", "\x1b", "q", "q"],
            3500,
            120,
          ),
        ],
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const text = stripAnsi(result.stdout);
      assert.match(text, /Invalid key for NVIDIA NIM/);
      assert.match(text, /Expected prefix "nvapi-"/);

      const cfg = JSON.parse(readFileSync(join(home, ".free-router.json"), "utf8"));
      assert.equal(cfg.apiKeys.nvidia, "nvapi-keep-me");
    } finally {
      cleanupTempHome(home);
    }
  },
);
