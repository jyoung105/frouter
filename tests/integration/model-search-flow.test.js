import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty, stripAnsi } from '../helpers/run-pty.js';
import { BIN_PATH, ROOT_DIR } from '../helpers/test-paths.js';
import { cleanupTempHome, defaultConfig, makeTempHome, writeHomeConfig } from '../helpers/temp-home.js';

const SKIP = process.platform === 'win32';

test(
  'interactive model search flow (/, typing, backspace, ESC)',
  { skip: SKIP && 'PTY harness uses `script`, unavailable on Windows' },
  async () => {
    const home = makeTempHome();
    try {
      writeHomeConfig(home, defaultConfig({
        apiKeys: { nvidia: 'nvapi-test' },
        providers: {
          nvidia: { enabled: true },
          openrouter: { enabled: false },
        },
      }));

      const sequence = [
        { delayMs: 850, data: '/' },
        { delayMs: 980, data: 'l' },
        { delayMs: 1110, data: 'l' },
        { delayMs: 1240, data: 'a' },
        { delayMs: 1370, data: 'm' },
        { delayMs: 1500, data: 'a' },
        { delayMs: 1630, data: '\x7f' }, // backspace
        { delayMs: 1780, data: '\x1b' }, // exit search mode
        { delayMs: 1960, data: 'q' },    // quit app
      ];

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: { HOME: home, FROUTER_NO_FETCH: '1' },
        inputChunks: sequence,
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const text = stripAnsi(result.stdout);
      assert.match(text, /\/llama_/);     // search query while editing
      assert.match(text, /\/llam_/);      // after backspace
      assert.match(text, /\/ search/);    // after ESC
    } finally {
      cleanupTempHome(home);
    }
  }
);

test(
  'interactive search error scenario: no matching model shows empty result count',
  { skip: SKIP && 'PTY harness uses `script`, unavailable on Windows' },
  async () => {
    const home = makeTempHome();
    try {
      writeHomeConfig(home, defaultConfig({
        apiKeys: { nvidia: 'nvapi-test' },
        providers: {
          nvidia: { enabled: true },
          openrouter: { enabled: false },
        },
      }));

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: { HOME: home, FROUTER_NO_FETCH: '1' },
        inputChunks: [
          { delayMs: 850, data: '/' },
          { delayMs: 980, data: 'z' },
          { delayMs: 1110, data: 'z' },
          { delayMs: 1240, data: 'z' },
          { delayMs: 1370, data: 'z' },
          { delayMs: 1600, data: '\x1b' }, // exit search mode first
          { delayMs: 1900, data: 'q' },
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
  }
);

test(
  'pressing Enter in search mode applies selected model to OpenCode only',
  { skip: SKIP && 'PTY harness uses `script`, unavailable on Windows' },
  async () => {
    const home = makeTempHome();
    try {
      writeHomeConfig(home, defaultConfig({
        apiKeys: { nvidia: 'nvapi-test' },
        providers: {
          nvidia: { enabled: true },
          openrouter: { enabled: false },
        },
      }));

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: { HOME: home, FROUTER_NO_FETCH: '1' },
        inputChunks: [
          { delayMs: 850, data: '/' },
          { delayMs: 980, data: 'l' },
          { delayMs: 1110, data: 'l' },
          { delayMs: 1240, data: 'a' },
          { delayMs: 1370, data: 'm' },
          { delayMs: 1500, data: 'a' },
          { delayMs: 1700, data: '\r' },  // apply directly from search mode
          { delayMs: 2500, data: 'q' },   // exit app
        ],
        timeoutMs: 12_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);

      const openCodePath = join(home, '.config', 'opencode', 'opencode.json');
      const openClawPath = join(home, '.openclaw', 'openclaw.json');
      assert.equal(existsSync(openCodePath), true);
      assert.equal(existsSync(openClawPath), false);
      assert.match(readFileSync(openCodePath, 'utf8'), /"model": "nvidia\/meta\/llama/i);
      assert.match(readFileSync(openCodePath, 'utf8'), /"apiKey": "\{env:NVIDIA_API_KEY\}"/);

      const text = stripAnsi(result.stdout);
      assert.match(text, /OpenCode model set/);
      assert.doesNotMatch(text, /OpenClaw model set/);
    } finally {
      cleanupTempHome(home);
    }
  }
);
