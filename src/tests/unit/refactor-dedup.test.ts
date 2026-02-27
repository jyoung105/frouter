// Tests for code simplification & deduplication refactors
import test from "node:test";
import assert from "node:assert/strict";
import {
  visLen,
  pad,
  sortModels,
  TIER_CYCLE,
  TIER_ORDER,
  R,
  B,
  D,
  GREEN,
  RED,
  YELLOW,
} from "../../lib/utils.js";

// ─── 1. TIER_ORDER export & shape ────────────────────────────────────────────

test("TIER_ORDER is exported and contains all expected tiers", () => {
  assert.equal(typeof TIER_ORDER, "object");
  const expectedTiers = ["S+", "S", "A+", "A", "A-", "B+", "B", "C"];
  for (const tier of expectedTiers) {
    assert.ok(
      tier in TIER_ORDER,
      `TIER_ORDER should contain key "${tier}"`,
    );
    assert.equal(typeof TIER_ORDER[tier], "number");
  }
});

test("TIER_ORDER values are strictly ascending (lower = higher priority)", () => {
  const ordered = ["S+", "S", "A+", "A", "A-", "B+", "B", "C"];
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(
      TIER_ORDER[ordered[i]] > TIER_ORDER[ordered[i - 1]],
      `${ordered[i]} (${TIER_ORDER[ordered[i]]}) should be > ${ordered[i - 1]} (${TIER_ORDER[ordered[i - 1]]})`,
    );
  }
});

test("TIER_ORDER keys match TIER_CYCLE (minus 'All')", () => {
  const cycleWithoutAll = TIER_CYCLE.filter((t) => t !== "All");
  const orderKeys = Object.keys(TIER_ORDER);
  assert.deepEqual(
    cycleWithoutAll.sort(),
    orderKeys.sort(),
  );
});

test("TIER_ORDER returns undefined for unknown tier (used as ?? 99 fallback)", () => {
  assert.equal(TIER_ORDER["Z"], undefined);
  assert.equal(TIER_ORDER[""], undefined);
  assert.equal((TIER_ORDER["Z"] ?? 99), 99);
});

// ─── 2. sortModels using TIER_ORDER (regression) ────────────────────────────

test("sortModels tier sort uses exported TIER_ORDER correctly", () => {
  const models = [
    { tier: "C", providerKey: "x", pings: [] },
    { tier: "S+", providerKey: "x", pings: [] },
    { tier: "A-", providerKey: "x", pings: [] },
    { tier: "B+", providerKey: "x", pings: [] },
    { tier: "S", providerKey: "x", pings: [] },
  ];
  const sorted = sortModels(models, "tier", true);
  assert.deepEqual(
    sorted.map((m) => m.tier),
    ["S+", "S", "A-", "B+", "C"],
  );
});

test("sortModels tier sort descending reverses order", () => {
  const models = [
    { tier: "S+", providerKey: "x", pings: [] },
    { tier: "C", providerKey: "x", pings: [] },
    { tier: "A", providerKey: "x", pings: [] },
  ];
  const sorted = sortModels(models, "tier", false);
  assert.deepEqual(
    sorted.map((m) => m.tier),
    ["C", "A", "S+"],
  );
});

test("sortModels handles unknown tier (sorts last with ?? 99)", () => {
  const models = [
    { tier: "S+", providerKey: "x", pings: [] },
    { tier: "UNKNOWN", providerKey: "x", pings: [] },
    { tier: "C", providerKey: "x", pings: [] },
  ];
  const sorted = sortModels(models, "tier", true);
  assert.equal(sorted[0].tier, "S+");
  assert.equal(sorted[1].tier, "C");
  assert.equal(sorted[2].tier, "UNKNOWN");
});

test("sortModels handles null/undefined tier (sorts last)", () => {
  const models = [
    { tier: null, providerKey: "x", pings: [] },
    { tier: "A", providerKey: "x", pings: [] },
    { tier: undefined, providerKey: "x", pings: [] },
  ];
  const sorted = sortModels(models, "tier", true);
  assert.equal(sorted[0].tier, "A");
});

// ─── 3. visLen fast ASCII path — happy path ─────────────────────────────────

test("visLen fast path: pure ASCII returns string length directly", () => {
  assert.equal(visLen("hello world"), 11);
  assert.equal(visLen("abc"), 3);
  assert.equal(visLen("x"), 1);
});

test("visLen fast path: empty string returns 0", () => {
  assert.equal(visLen(""), 0);
});

test("visLen fast path: ASCII with spaces and punctuation", () => {
  assert.equal(visLen("hello, world! 123."), 18);
  assert.equal(visLen("foo-bar_baz"), 11);
  assert.equal(visLen("  leading spaces  "), 18);
});

test("visLen fast path: ASCII with tab and control chars", () => {
  // Tab is \x09, which is < \x80 so it's ASCII
  assert.equal(visLen("\t"), 1);
  assert.equal(visLen("a\tb"), 3);
});

test("visLen fast path: ANSI codes stripped, remaining ASCII uses fast path", () => {
  // After stripping ANSI, "ok" is pure ASCII
  assert.equal(visLen(`${GREEN}ok${R}`), 2);
  assert.equal(visLen(`${B}${RED}hello${R}`), 5);
  assert.equal(visLen(`${D}dimmed text${R}`), 11);
});

test("visLen fast path: multiple nested ANSI codes still produce correct ASCII length", () => {
  const s = `${B}${GREEN}bold green${R}${D} dim${R}`;
  assert.equal(visLen(s), 14); // "bold green dim"
});

test("visLen fast path: ANSI-only string returns 0", () => {
  assert.equal(visLen(`${GREEN}${R}`), 0);
  assert.equal(visLen(`${B}${D}${RED}${R}`), 0);
});

// ─── 4. visLen slow path — non-ASCII / emoji ────────────────────────────────

test("visLen slow path: single emoji counted as 2 columns", () => {
  const len = visLen("🚀");
  assert.ok(len >= 2, `expected emoji to be at least 2 columns, got ${len}`);
});

test("visLen slow path: emoji with surrounding ASCII", () => {
  const len = visLen("hi 🚀 go");
  // "hi " = 3, 🚀 = 2, " go" = 3 => 8
  assert.ok(len >= 8, `expected at least 8, got ${len}`);
});

test("visLen slow path: multiple emoji", () => {
  const len = visLen("🚀🐢🐌");
  assert.ok(len >= 6, `expected at least 6 for 3 emoji, got ${len}`);
});

test("visLen slow path: emoji with ANSI codes", () => {
  const len = visLen(`${GREEN}🚀${R} ok`);
  // 🚀 = 2, " ok" = 3 => 5
  assert.ok(len >= 5, `expected at least 5, got ${len}`);
});

test("visLen slow path: non-ASCII Latin characters (above 0x7f)", () => {
  // These are single-width but non-ASCII, so they go through slow path
  const len = visLen("café");
  assert.equal(len, 4); // é is 1 column wide
});

test("visLen slow path: CJK-adjacent unicode (ZWJ, variation selectors)", () => {
  // Variation selector U+FE0F is in the emoji regex range
  const len = visLen("⚡");
  assert.ok(len >= 1, `expected at least 1 for ⚡, got ${len}`);
});

// ─── 5. visLen edge cases ───────────────────────────────────────────────────

test("visLen handles number input via String coercion", () => {
  assert.equal(visLen(12345), 5);
  assert.equal(visLen(0), 1);
});

test("visLen handles null/undefined via String coercion", () => {
  assert.equal(visLen(null), 4); // "null"
  assert.equal(visLen(undefined), 9); // "undefined"
});

test("visLen: pad still works correctly with fast-path visLen", () => {
  const result = pad("hello", 10);
  assert.equal(result, "hello     ");
  assert.equal(visLen(result), 10);
});

test("visLen: pad with ANSI uses fast path after stripping", () => {
  const colored = `${GREEN}ok${R}`;
  const result = pad(colored, 6);
  assert.equal(visLen(result), 6);
});

// ─── 6. Verify ping.ts TIER_ORDER import works (sort in pingAllOnce) ────────

test("TIER_ORDER used by ping sort: S+ models sort before C models", () => {
  // This verifies the TIER_ORDER constant is correctly shared between utils and ping
  const sPlusVal = TIER_ORDER["S+"];
  const cVal = TIER_ORDER["C"];
  assert.ok(sPlusVal < cVal, `S+ (${sPlusVal}) should sort before C (${cVal})`);
});

// ─── 7. sortModels priority sort regression (uses TIER_ORDER internally) ────

test("sortModels priority: up+high-tier beats up+low-tier", () => {
  const models = [
    {
      tier: "C",
      providerKey: "nvidia",
      id: "c-model",
      displayName: "C Model",
      status: "up",
      pings: [{ code: "200", ms: 100 }],
    },
    {
      tier: "S+",
      providerKey: "nvidia",
      id: "s-model",
      displayName: "S Model",
      status: "up",
      pings: [{ code: "200", ms: 100 }],
    },
  ];
  const sorted = sortModels(models, "priority", true);
  assert.equal(sorted[0].tier, "S+");
  assert.equal(sorted[1].tier, "C");
});

test("sortModels priority: all tiers in correct order when status and latency are equal", () => {
  const tiers = ["C", "B", "B+", "A-", "A", "A+", "S", "S+"];
  const models = tiers.map((tier) => ({
    tier,
    providerKey: "nvidia",
    id: `model-${tier}`,
    displayName: `Model ${tier}`,
    status: "up",
    pings: [{ code: "200", ms: 200 }],
  }));
  const sorted = sortModels(models, "priority", true);
  assert.deepEqual(
    sorted.map((m) => m.tier),
    ["S+", "S", "A+", "A", "A-", "B+", "B", "C"],
  );
});
