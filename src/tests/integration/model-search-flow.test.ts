import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

function getLatestFrame(rawOutput, needle) {
  const chunks = String(rawOutput).split("\x1b[2J\x1b[H");
  for (let i = chunks.length - 1; i >= 0; i--) {
    const frame = stripAnsi(chunks[i]);
    if (frame.includes(needle)) return frame;
  }
  return "";
}

function buildInputChunks(tokens, startDelayMs = 850, stepMs = 120) {
  let delayMs = startDelayMs;
  return tokens.map((data) => {
    const chunk = { delayMs, data };
    delayMs += stepMs;
    return chunk;
  });
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
        env: { HOME: home, FROUTER_NO_FETCH: "1" },
        inputChunks: sequence,
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const text = stripAnsi(result.stdout);
      assert.match(text, /\/llama_/); // search query while editing
      assert.match(text, /\/llam_/); // after backspace
      assert.match(text, /\/ search/); // after ESC
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
        env: { HOME: home, FROUTER_NO_FETCH: "1" },
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
        env: { HOME: home, FROUTER_NO_FETCH: "1" },
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
      assert.match(lines[headerIdx + 1] || "", /^\s+1\s+/);
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
  "pressing Enter in search mode applies selected model to OpenCode only",
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
        env: { HOME: home, FROUTER_NO_FETCH: "1" },
        inputChunks: [
          { delayMs: 850, data: "/" },
          { delayMs: 980, data: "l" },
          { delayMs: 1110, data: "l" },
          { delayMs: 1240, data: "a" },
          { delayMs: 1370, data: "m" },
          { delayMs: 1500, data: "a" },
          { delayMs: 1700, data: "\r" }, // apply directly from search mode
          { delayMs: 2500, data: "q" }, // exit app
        ],
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const openCodePath = join(home, ".config", "opencode", "opencode.json");
      const openClawPath = join(home, ".openclaw", "openclaw.json");
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
      assert.match(text, /OpenCode model set/);
      assert.match(text, /OpenCode auth uses NVIDIA_API_KEY/);
      assert.doesNotMatch(text, /OpenClaw model set/);
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
        env: { HOME: home, FROUTER_NO_FETCH: "1" },
        inputChunks: buildInputChunks([
          "a",
          ..."nvapi-added-main-tab",
          "\r",
          "q",
          "q",
        ]),
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const cfg = JSON.parse(readFileSync(join(home, ".frouter.json"), "utf8"));
      assert.equal(cfg.apiKeys.nvidia, "nvapi-added-main-tab");
      assert.equal(cfg.apiKeys.openrouter, "sk-or-test");
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
        env: { HOME: home, FROUTER_NO_FETCH: "1" },
        inputChunks: buildInputChunks([
          "A",
          ..."nvapi-new-main-tab",
          "\r",
          "q",
          "q",
        ]),
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const cfg = JSON.parse(readFileSync(join(home, ".frouter.json"), "utf8"));
      assert.equal(cfg.apiKeys.nvidia, "nvapi-new-main-tab");
    } finally {
      cleanupTempHome(home);
    }
  },
);

test(
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
        env: { HOME: home, FROUTER_NO_FETCH: "1" },
        inputChunks: buildInputChunks([
          "a",
          ..."bad-prefix",
          "\r",
          "\x1b",
          "q",
          "q",
        ]),
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const text = stripAnsi(result.stdout);
      assert.match(text, /Invalid key for NVIDIA NIM/);
      assert.match(text, /Expected prefix "nvapi-"/);

      const cfg = JSON.parse(readFileSync(join(home, ".frouter.json"), "utf8"));
      assert.equal(cfg.apiKeys.nvidia, "nvapi-keep-me");
    } finally {
      cleanupTempHome(home);
    }
  },
);
