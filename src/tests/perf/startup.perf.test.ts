import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { runNode } from '../helpers/spawn-cli.js';
import { BIN_PATH, ROOT_DIR } from '../helpers/test-paths.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const baselineFilePath = join(__dir, 'baseline.json');

function resolveBaselineStartupMs(): number {
  const fromEnv = Number(process.env.BASELINE_STARTUP_MS ?? '0');
  if (fromEnv > 0 && !Number.isNaN(fromEnv)) return fromEnv;
  if (!existsSync(baselineFilePath)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(baselineFilePath, 'utf8'));
    const fromFile = Number(parsed?.startupMs ?? '0');
    return Number.isNaN(fromFile) ? 0 : fromFile;
  } catch {
    return 0;
  }
}

test('perf: CLI --help startup regression <= 5% of baseline', async (t) => {
  const baselineStartupMs = resolveBaselineStartupMs();
  if (!baselineStartupMs || Number.isNaN(baselineStartupMs)) {
    t.skip('Set BASELINE_STARTUP_MS or run `npm run perf:baseline` first.');
    return;
  }

  const t0 = performance.now();
  const result = await runNode([BIN_PATH, '--help'], { cwd: ROOT_DIR, timeoutMs: 15_000 });
  const elapsedMs = performance.now() - t0;
  const budgetMs = Math.max(baselineStartupMs * 1.05, baselineStartupMs + 20);

  assert.equal(result.code, 0, `expected exit 0, got ${result.code}\n${result.stderr}`);
  assert.ok(
    elapsedMs <= budgetMs,
    `startup regression: ${elapsedMs.toFixed(2)}ms > ${budgetMs.toFixed(2)}ms (baseline=${baselineStartupMs}ms)`
  );
});
