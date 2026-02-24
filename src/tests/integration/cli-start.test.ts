import test from 'node:test';
import assert from 'node:assert/strict';
import { runInPty } from '../helpers/run-pty.js';
import { BIN_PATH, ROOT_DIR } from '../helpers/test-paths.js';
import { cleanupTempHome, defaultConfig, makeTempHome, writeHomeConfig } from '../helpers/temp-home.js';
import { runNode } from '../helpers/spawn-cli.js';

test('CLI --help prints usage and exits with code 0', async () => {
  const result = await runNode([BIN_PATH, '--help'], { cwd: ROOT_DIR });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: frouter/);
});

test('CLI -h (edge alias) prints usage and exits with code 0', async () => {
  const result = await runNode([BIN_PATH, '-h'], { cwd: ROOT_DIR });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /frouter — Free Model Router/);
});

test('CLI --best exits with code 1 when no API keys are configured', async () => {
  const home = makeTempHome();
  try {
    const result = await runNode([BIN_PATH, '--best'], {
      cwd: ROOT_DIR,
      env: { HOME: home },
      timeoutMs: 15_000,
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /No API keys configured/);
  } finally {
    cleanupTempHome(home);
  }
});

test('CLI (interactive mode) fails fast without a TTY', async () => {
  const home = makeTempHome();
  try {
    writeHomeConfig(home, defaultConfig({
      apiKeys: { nvidia: 'nvapi-test' },
    }));

    const result = await runNode([BIN_PATH], {
      cwd: ROOT_DIR,
      env: { HOME: home },
      timeoutMs: 7_000,
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /requires an interactive terminal/i);
  } finally {
    cleanupTempHome(home);
  }
});

const SKIP = process.platform === 'win32';

test(
  'CLI interactive happy path starts in TTY and exits on q',
  { skip: SKIP && 'PTY harness uses python pty (not available on Windows)' },
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
        env: { HOME: home },
        inputChunks: [{ delayMs: 1000, data: 'q' }],
        timeoutMs: 10_000,
      });

      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);
    } finally {
      cleanupTempHome(home);
    }
  }
);
