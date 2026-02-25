import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAvg, getUptime, getVerdict,
  tierColor, latColor, uptimeColor,
  filterByTier, sortModels,
  visLen, pad,
  R, B, D, RED, GREEN, YELLOW, CYAN, WHITE, ORANGE, BG_SEL,
  TIER_CYCLE,
} from '../../lib/utils.js';

// ─── getAvg ──────────────────────────────────────────────────────────────────

test('getAvg returns Infinity when model has no pings', () => {
  assert.equal(getAvg({ pings: [] }), Infinity);
});

test('getAvg returns Infinity when no HTTP 200 pings exist', () => {
  assert.equal(getAvg({ pings: [{ code: '404', ms: 100 }, { code: '500', ms: 200 }] }), Infinity);
});

test('getAvg computes average from HTTP 200 pings only', () => {
  const model = {
    pings: [
      { code: '200', ms: 100 },
      { code: '500', ms: 9999 },  // ignored
      { code: '200', ms: 300 },
    ],
  };
  assert.equal(getAvg(model), 200);
});

test('getAvg handles single HTTP 200 ping', () => {
  assert.equal(getAvg({ pings: [{ code: '200', ms: 42 }] }), 42);
});

// ─── getUptime ───────────────────────────────────────────────────────────────

test('getUptime returns 0 for empty pings', () => {
  assert.equal(getUptime({ pings: [] }), 0);
});

test('getUptime returns 100 when all pings are 200', () => {
  assert.equal(getUptime({ pings: [{ code: '200', ms: 50 }, { code: '200', ms: 60 }] }), 100);
});

test('getUptime returns 0 when no pings are 200', () => {
  assert.equal(getUptime({ pings: [{ code: '500', ms: 50 }, { code: '404', ms: 60 }] }), 0);
});

test('getUptime computes correct percentage for mixed pings', () => {
  const model = {
    pings: [
      { code: '200', ms: 50 },
      { code: '500', ms: 100 },
      { code: '200', ms: 60 },
      { code: '200', ms: 70 },
    ],
  };
  assert.equal(getUptime(model), 75);
});

// ─── getVerdict ──────────────────────────────────────────────────────────────

test('getVerdict: Pending when no successful pings', () => {
  assert.equal(getVerdict({ pings: [], status: 'pending' }), '⏳ Pending');
});

test('getVerdict: Perfect when avg < 400ms', () => {
  assert.equal(getVerdict({
    pings: [{ code: '200', ms: 150 }],
    status: 'up',
  }), '🚀 Perfect');
});

test('getVerdict: Normal when avg 400-999ms', () => {
  assert.equal(getVerdict({
    pings: [{ code: '200', ms: 600 }],
    status: 'up',
  }), '✅ Normal');
});

test('getVerdict: Slow when avg 1000-2999ms', () => {
  assert.equal(getVerdict({
    pings: [{ code: '200', ms: 2000 }],
    status: 'up',
  }), '🐢 Slow');
});

test('getVerdict: Very Slow when avg 3000-4999ms', () => {
  assert.equal(getVerdict({
    pings: [{ code: '200', ms: 4000 }],
    status: 'up',
  }), '🐌 Very Slow');
});

test('getVerdict: Unusable when avg >= 5000ms', () => {
  assert.equal(getVerdict({
    pings: [{ code: '200', ms: 6000 }],
    status: 'up',
  }), '💀 Unusable');
});

test('getVerdict: Overloaded when latest ping is 429', () => {
  assert.equal(getVerdict({
    pings: [{ code: '200', ms: 100 }, { code: '429', ms: 50 }],
    status: 'down',
  }), '🔥 Overloaded');
});

test('getVerdict: Unstable when model was up but now not', () => {
  assert.equal(getVerdict({
    pings: [{ code: '200', ms: 100 }, { code: '500', ms: 200 }],
    status: 'down',
  }), '⚠️  Unstable');
});

test('getVerdict: Not Active when never responded up', () => {
  assert.equal(getVerdict({
    pings: [{ code: '500', ms: 100 }, { code: '500', ms: 200 }],
    status: 'down',
  }), '👻 Not Active');
});

test('getVerdict: Not Found for notfound status', () => {
  assert.equal(getVerdict({
    pings: [{ code: '404', ms: 100 }],
    status: 'notfound',
  }), '🚫 Not Found');
});

// ─── tierColor ───────────────────────────────────────────────────────────────

test('tierColor returns bold white for S+ and S tiers', () => {
  assert.equal(tierColor('S+'), WHITE + B);
  assert.equal(tierColor('S'), WHITE + B);
});

test('tierColor returns yellow for A-family tiers', () => {
  assert.equal(tierColor('A+'), YELLOW);
  assert.equal(tierColor('A'), YELLOW);
  assert.equal(tierColor('A-'), YELLOW);
});

test('tierColor returns red for B and C tiers', () => {
  assert.equal(tierColor('B+'), RED);
  assert.equal(tierColor('B'), RED);
  assert.equal(tierColor('C'), RED);
});

test('tierColor returns red for unknown/null tier', () => {
  assert.equal(tierColor(null), RED);
  assert.equal(tierColor('?'), RED);
});

// ─── latColor ────────────────────────────────────────────────────────────────

test('latColor returns green for < 500ms', () => {
  assert.equal(latColor(100), GREEN);
  assert.equal(latColor(499), GREEN);
});

test('latColor returns yellow for 500-1499ms', () => {
  assert.equal(latColor(500), YELLOW);
  assert.equal(latColor(1499), YELLOW);
});

test('latColor returns red for >= 1500ms', () => {
  assert.equal(latColor(1500), RED);
  assert.equal(latColor(5000), RED);
});

// ─── uptimeColor ─────────────────────────────────────────────────────────────

test('uptimeColor returns green for >= 90%', () => {
  assert.equal(uptimeColor(90), GREEN);
  assert.equal(uptimeColor(100), GREEN);
});

test('uptimeColor returns yellow for 70-89%', () => {
  assert.equal(uptimeColor(70), YELLOW);
  assert.equal(uptimeColor(89), YELLOW);
});

test('uptimeColor returns orange for 50-69%', () => {
  assert.equal(uptimeColor(50), ORANGE);
  assert.equal(uptimeColor(69), ORANGE);
});

test('uptimeColor returns red for < 50%', () => {
  assert.equal(uptimeColor(0), RED);
  assert.equal(uptimeColor(49), RED);
});

// ─── filterByTier ────────────────────────────────────────────────────────────

test('filterByTier returns all models when tier is All', () => {
  const models = [{ tier: 'S' }, { tier: 'A' }, { tier: 'B' }];
  assert.equal(filterByTier(models, 'All').length, 3);
});

test('filterByTier returns only models matching tier', () => {
  const models = [
    { tier: 'S', id: 'a' },
    { tier: 'A', id: 'b' },
    { tier: 'S', id: 'c' },
  ];
  const result = filterByTier(models, 'S');
  assert.equal(result.length, 2);
  assert.ok(result.every(m => m.tier === 'S'));
});

test('filterByTier returns empty for non-matching tier', () => {
  const models = [{ tier: 'S' }, { tier: 'A' }];
  assert.equal(filterByTier(models, 'C').length, 0);
});

// ─── sortModels (non-priority columns) ───────────────────────────────────────

test('sortModels by tier column', () => {
  const models = [
    { tier: 'B', providerKey: 'x', pings: [] },
    { tier: 'S+', providerKey: 'x', pings: [] },
    { tier: 'A', providerKey: 'x', pings: [] },
  ];
  const sorted = sortModels(models, 'tier', true);
  assert.equal(sorted[0].tier, 'S+');
  assert.equal(sorted[1].tier, 'A');
  assert.equal(sorted[2].tier, 'B');
});

test('sortModels by provider column', () => {
  const models = [
    { providerKey: 'openrouter', pings: [] },
    { providerKey: 'nvidia', pings: [] },
  ];
  const sorted = sortModels(models, 'provider', true);
  assert.equal(sorted[0].providerKey, 'nvidia');
  assert.equal(sorted[1].providerKey, 'openrouter');
});

test('sortModels by model name column', () => {
  const models = [
    { displayName: 'Zebra', id: 'z', pings: [] },
    { displayName: 'Alpha', id: 'a', pings: [] },
  ];
  const sorted = sortModels(models, 'model', true);
  assert.equal(sorted[0].displayName, 'Alpha');
  assert.equal(sorted[1].displayName, 'Zebra');
});

test('sortModels by context column', () => {
  const models = [
    { context: 8192, pings: [] },
    { context: 131072, pings: [] },
    { context: 32768, pings: [] },
  ];
  const sorted = sortModels(models, 'context', true);
  assert.equal(sorted[0].context, 8192);
  assert.equal(sorted[2].context, 131072);
});

test('sortModels by intel column', () => {
  const models = [
    { aaIntelligence: 80, pings: [] },
    { aaIntelligence: null, pings: [] },
    { aaIntelligence: 40, pings: [] },
  ];
  const sorted = sortModels(models, 'intel', true);
  assert.equal(sorted[0].aaIntelligence, null);
  assert.equal(sorted[2].aaIntelligence, 80);
});

test('sortModels by avg column', () => {
  const models = [
    { pings: [{ code: '200', ms: 500 }] },
    { pings: [{ code: '200', ms: 100 }] },
    { pings: [] }, // Infinity
  ];
  const sorted = sortModels(models, 'avg', true);
  assert.equal(getAvg(sorted[0]), 100);
  assert.equal(getAvg(sorted[1]), 500);
  assert.equal(getAvg(sorted[2]), Infinity);
});

test('sortModels by uptime column', () => {
  const models = [
    { pings: [{ code: '200', ms: 50 }, { code: '200', ms: 60 }] },
    { pings: [{ code: '200', ms: 50 }, { code: '500', ms: 60 }] },
    { pings: [{ code: '500', ms: 50 }, { code: '500', ms: 60 }] },
  ];
  const sorted = sortModels(models, 'uptime', true);
  assert.equal(getUptime(sorted[0]), 0);
  assert.equal(getUptime(sorted[2]), 100);
});

test('sortModels reverse direction (asc=false)', () => {
  const models = [
    { tier: 'S+', providerKey: 'x', pings: [] },
    { tier: 'B', providerKey: 'x', pings: [] },
  ];
  const sorted = sortModels(models, 'tier', false);
  assert.equal(sorted[0].tier, 'B');
  assert.equal(sorted[1].tier, 'S+');
});

// ─── visLen ──────────────────────────────────────────────────────────────────

test('visLen returns correct length for plain ASCII text', () => {
  assert.equal(visLen('hello'), 5);
  assert.equal(visLen(''), 0);
});

test('visLen strips ANSI codes from length calculation', () => {
  assert.equal(visLen(`${GREEN}ok${R}`), 2);
  assert.equal(visLen(`${B}${RED}bold red${R}`), 8);
});

test('visLen counts emoji as 2 columns wide', () => {
  const len = visLen('hi');
  assert.ok(len >= 2, `expected emoji to be at least 2 columns, got ${len}`);
});

test('visLen handles mixed ANSI + emoji + text', () => {
  const s = `${GREEN}ok${R} done`;
  const len = visLen(s);
  assert.ok(len >= 7, `expected at least 7 visible columns, got ${len}`);
});

// ─── pad ─────────────────────────────────────────────────────────────────────

test('pad left-aligns text to specified width', () => {
  const result = pad('hi', 5);
  assert.equal(result, 'hi   ');
});

test('pad right-aligns text when right=true', () => {
  const result = pad('hi', 5, true);
  assert.equal(result, '   hi');
});

test('pad does not truncate text longer than width', () => {
  const result = pad('hello world', 5);
  assert.ok(result.includes('hello world'));
});

test('pad accounts for ANSI codes in width calculation', () => {
  const colored = `${GREEN}ok${R}`;
  const result = pad(colored, 5);
  // "ok" is 2 visible chars, so 3 spaces should be appended
  assert.ok(result.endsWith('   '));
});

// ─── TIER_CYCLE ──────────────────────────────────────────────────────────────

test('TIER_CYCLE starts with All and includes all tiers', () => {
  assert.equal(TIER_CYCLE[0], 'All');
  assert.ok(TIER_CYCLE.includes('S+'));
  assert.ok(TIER_CYCLE.includes('S'));
  assert.ok(TIER_CYCLE.includes('A+'));
  assert.ok(TIER_CYCLE.includes('A'));
  assert.ok(TIER_CYCLE.includes('A-'));
  assert.ok(TIER_CYCLE.includes('B+'));
  assert.ok(TIER_CYCLE.includes('B'));
  assert.ok(TIER_CYCLE.includes('C'));
  assert.equal(TIER_CYCLE.length, 9);
});

// ─── ANSI exports ────────────────────────────────────────────────────────────

test('ANSI color constants are non-empty escape sequences', () => {
  for (const val of [R, B, D, RED, GREEN, YELLOW, CYAN, WHITE, ORANGE, BG_SEL]) {
    assert.ok(typeof val === 'string' && val.startsWith('\x1b'), `Expected ANSI escape, got: ${JSON.stringify(val)}`);
  }
});
