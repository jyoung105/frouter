import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { runNode } from "../helpers/spawn-cli.js";
import { BIN_PATH, ROOT_DIR } from "../helpers/test-paths.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const baselineFilePath = join(__dir, "baseline.json");
const ABS_STARTUP_CEILING_MS = Number(
  process.env.PERF_STARTUP_ABS_CEILING_MS ?? "140",
);
const STARTUP_RUNS = Number(process.env.PERF_STARTUP_RUNS ?? "8");

function resolveBaselineStartupMs(): number {
  const fromEnv = Number(process.env.BASELINE_STARTUP_MS ?? "0");
  if (fromEnv > 0 && !Number.isNaN(fromEnv)) return fromEnv;
  if (!existsSync(baselineFilePath)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(baselineFilePath, "utf8"));
    const fromFile = Number(parsed?.startupMs ?? "0");
    return Number.isNaN(fromFile) ? 0 : fromFile;
  } catch {
    return 0;
  }
}

test("perf: CLI --help startup stays under absolute ceiling and baseline budget", async () => {
  const baselineStartupMs = resolveBaselineStartupMs();
  const runs: number[] = [];
  for (let i = 0; i < STARTUP_RUNS; i++) {
    const t0 = performance.now();
    const result = await runNode([BIN_PATH, "--help"], {
      cwd: ROOT_DIR,
      timeoutMs: 15_000,
    });
    const elapsedMs = performance.now() - t0;
    assert.equal(
      result.code,
      0,
      `expected exit 0, got ${result.code}\n${result.stderr}`,
    );
    runs.push(elapsedMs);
  }

  const avgMs = runs.reduce((sum, ms) => sum + ms, 0) / runs.length;
  assert.ok(
    avgMs <= ABS_STARTUP_CEILING_MS,
    `startup absolute ceiling exceeded: ${avgMs.toFixed(2)}ms > ${ABS_STARTUP_CEILING_MS.toFixed(2)}ms`,
  );

  if (baselineStartupMs > 0 && Number.isFinite(baselineStartupMs)) {
    const relativeBudgetMs = Math.max(
      baselineStartupMs * 1.05,
      baselineStartupMs + 20,
    );
    assert.ok(
      avgMs <= relativeBudgetMs,
      `startup baseline regression: ${avgMs.toFixed(2)}ms > ${relativeBudgetMs.toFixed(2)}ms (baseline=${baselineStartupMs}ms)`,
    );
  }
});
