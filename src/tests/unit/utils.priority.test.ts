import test from "node:test";
import assert from "node:assert/strict";
import { sortModels, findBestModel } from "../../lib/utils.js";

function model({
  id,
  displayName = id,
  providerKey = "nvidia",
  tier = "S",
  status = "up",
  pings = [],
}) {
  return { id, displayName, providerKey, tier, status, pings };
}

test("priority sort: availability first (up before non-up)", () => {
  const upLowTier = model({
    id: "up-low-tier",
    tier: "B",
    status: "up",
    pings: [{ code: "200", ms: 900 }],
  });
  const downHighTier = model({
    id: "down-high-tier",
    tier: "S+",
    status: "down",
    pings: [{ code: "500", ms: 50 }],
  });

  const out = sortModels([downHighTier, upLowTier], "priority", true);
  assert.equal(out[0].id, "up-low-tier");
  assert.equal(out[1].id, "down-high-tier");
});

test("priority sort: among available models, higher tier wins before latency", () => {
  const sSlow = model({
    id: "s-slow",
    tier: "S",
    status: "up",
    pings: [{ code: "200", ms: 2500 }],
  });
  const aPlusFast = model({
    id: "a+-fast",
    tier: "A+",
    status: "up",
    pings: [{ code: "200", ms: 120 }],
  });

  const out = sortModels([aPlusFast, sSlow], "priority", true);
  assert.equal(out[0].id, "s-slow");
  assert.equal(out[1].id, "a+-fast");
});

test("priority sort: avg latency breaks ties before uptime", () => {
  const fasterButLessStable = model({
    id: "faster",
    tier: "S",
    status: "up",
    pings: [
      { code: "200", ms: 120 },
      { code: "500", ms: 1000 },
    ],
  });
  const slowerButStable = model({
    id: "slower",
    tier: "S",
    status: "up",
    pings: [
      { code: "200", ms: 220 },
      { code: "200", ms: 220 },
    ],
  });

  const out = sortModels(
    [slowerButStable, fasterButLessStable],
    "priority",
    true,
  );
  assert.equal(out[0].id, "faster");
  assert.equal(out[1].id, "slower");
});

test("priority sort: uptime breaks ties when avg latency is equal", () => {
  const stable = model({
    id: "stable",
    tier: "A",
    status: "up",
    pings: [
      { code: "200", ms: 100 },
      { code: "200", ms: 100 },
    ],
  });
  const unstable = model({
    id: "unstable",
    tier: "A",
    status: "up",
    pings: [
      { code: "200", ms: 100 },
      { code: "500", ms: 700 },
    ],
  });

  const out = sortModels([unstable, stable], "priority", true);
  assert.equal(out[0].id, "stable");
  assert.equal(out[1].id, "unstable");
});

test("priority sort: deterministic fallback uses provider then name", () => {
  const nvidiaBeta = model({
    id: "nvidia-beta",
    displayName: "Beta",
    providerKey: "nvidia",
    tier: "S",
    status: "up",
    pings: [{ code: "200", ms: 150 }],
  });
  const openrouterAlpha = model({
    id: "openrouter-alpha",
    displayName: "Alpha",
    providerKey: "openrouter",
    tier: "S",
    status: "up",
    pings: [{ code: "200", ms: 150 }],
  });

  const out = sortModels([openrouterAlpha, nvidiaBeta], "priority", true);
  assert.equal(out[0].id, "nvidia-beta");
  assert.equal(out[1].id, "openrouter-alpha");
});

test("findBestModel follows the same priority rule stack", () => {
  const models = [
    model({
      id: "high-tier-down",
      tier: "S+",
      status: "down",
      pings: [{ code: "500", ms: 20 }],
    }),
    model({
      id: "up-s",
      tier: "S",
      status: "up",
      pings: [{ code: "200", ms: 400 }],
    }),
    model({
      id: "up-a+-fast",
      tier: "A+",
      status: "up",
      pings: [{ code: "200", ms: 120 }],
    }),
  ];

  const expected = sortModels(
    models.filter((m) => m.pings.length > 0),
    "priority",
    true,
  )[0];
  const best = findBestModel(models);

  assert.ok(best);
  assert.equal(best.id, expected.id);
  assert.equal(best.providerKey, expected.providerKey);
});
