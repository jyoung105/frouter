import test from "node:test";
import assert from "node:assert/strict";
import {
  applyModelPingResult,
  assertModelMetricsInvariant,
  getAvg,
  getUptime,
  getVerdict,
  isMetricsCacheEnabled,
  rebuildModelMetrics,
} from "../../lib/utils.js";

function makeModel() {
  return {
    id: "demo/model",
    providerKey: "nvidia",
    status: "pending",
    pings: [],
  } as any;
}

test("applyModelPingResult keeps rolling-window semantics and derived metrics", () => {
  const model = makeModel();

  applyModelPingResult(model, { code: "200", ms: 100 }, 3);
  applyModelPingResult(model, { code: "500", ms: 80 }, 3);
  applyModelPingResult(model, { code: "200", ms: 300 }, 3);

  assert.equal(model.pings.length, 3);
  assert.equal(getAvg(model), 200);
  assert.equal(getUptime(model), 67);

  applyModelPingResult(model, { code: "200", ms: 500 }, 3);
  // Oldest ping (200/100) must be evicted to preserve MAX_PINGS semantics.
  assert.equal(model.pings.length, 3);
  assert.deepEqual(
    model.pings.map((p: any) => p.code),
    ["500", "200", "200"],
  );
  assert.equal(getAvg(model), 400);
  assert.equal(getUptime(model), 67);
});

test("assertModelMetricsInvariant detects cache corruption", () => {
  const model = makeModel();
  applyModelPingResult(model, { code: "200", ms: 110 }, 5);
  applyModelPingResult(model, { code: "200", ms: 210 }, 5);

  const okBefore = assertModelMetricsInvariant(model);
  assert.equal(okBefore.ok, true);

  if (!isMetricsCacheEnabled()) return;
  model._metrics.sumOkMs += 999;

  const corrupted = assertModelMetricsInvariant(model);
  assert.equal(corrupted.ok, false);
  assert.match(corrupted.reason || "", /sumOkMs mismatch/);
});

test("rebuildModelMetrics restores parity for getAvg/getUptime/getVerdict", () => {
  const model = makeModel();
  model.status = "up";
  model.pings = [
    { code: "200", ms: 120 },
    { code: "500", ms: 10 },
    { code: "200", ms: 280 },
  ];

  rebuildModelMetrics(model);
  assert.equal(getAvg(model), 200);
  assert.equal(getUptime(model), 67);
  assert.equal(getVerdict(model), "🚀 Perfect");

  const canary = assertModelMetricsInvariant(model);
  assert.equal(canary.ok, true, canary.reason);
});
