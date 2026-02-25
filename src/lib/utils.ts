// src/lib/utils.ts — sort, filter, search, verdict, tier logic, ANSI color helpers

// ─── ANSI ──────────────────────────────────────────────────────────────────────
export const R  = '\x1b[0m';   // reset
export const B  = '\x1b[1m';   // bold
export const D  = '\x1b[2m';   // dim
export const RED    = '\x1b[31m';
export const GREEN  = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const CYAN   = '\x1b[36m';
export const WHITE  = '\x1b[37m';
export const ORANGE = '\x1b[38;5;208m';
export const BG_SEL = '\x1b[48;5;235m'; // subtle selection highlight

// ─── Tier order ────────────────────────────────────────────────────────────────
export const TIER_CYCLE = ['All', 'S+', 'S', 'A+', 'A', 'A-', 'B+', 'B', 'C'];
const TIER_ORDER = { 'S+': 0, 'S': 1, 'A+': 2, 'A': 3, 'A-': 4, 'B+': 5, 'B': 6, 'C': 7 };

// ─── Stats ─────────────────────────────────────────────────────────────────────

/** Average latency from HTTP 200 pings only. Returns Infinity if none yet. */
export function getAvg(model) {
  const ok = model.pings.filter(p => p.code === '200');
  if (!ok.length) return Infinity;
  return ok.reduce((s, p) => s + p.ms, 0) / ok.length;
}

/** Uptime % = HTTP 200 pings / total pings x 100. */
export function getUptime(model) {
  if (!model.pings.length) return 0;
  return Math.round(model.pings.filter(p => p.code === '200').length / model.pings.length * 100);
}

// ─── Verdict ───────────────────────────────────────────────────────────────────

/** Strict-priority verdict for a model (conditions before latency). */
export function getVerdict(model) {
  const last   = model.pings.at(-1);
  const avg    = getAvg(model);
  const everUp = model.pings.some(p => p.code === '200');

  if (last?.code === '429')                                              return '🔥 Overloaded';
  if (everUp && model.status !== 'up' && model.status !== 'noauth')     return '⚠️  Unstable';
  if (model.status === 'notfound')                                      return '🚫 Not Found';
  if (!everUp && model.pings.length > 0 && model.status !== 'pending')  return '👻 Not Active';
  if (avg === Infinity)                                                  return '⏳ Pending';
  if (avg < 400)   return '🚀 Perfect';
  if (avg < 1000)  return '✅ Normal';
  if (avg < 3000)  return '🐢 Slow';
  if (avg < 5000)  return '🐌 Very Slow';
  return '💀 Unusable';
}

// ─── Color helpers ─────────────────────────────────────────────────────────────

export function tierColor(tier) {
  if (tier === 'S+' || tier === 'S') return WHITE + B;
  if (tier?.startsWith('A'))         return YELLOW;
  return RED;
}

export function latColor(ms) {
  if (ms < 500)  return GREEN;
  if (ms < 1500) return YELLOW;
  return RED;
}

export function uptimeColor(pct) {
  if (pct >= 90) return GREEN;
  if (pct >= 70) return YELLOW;
  if (pct >= 50) return ORANGE;
  return RED;
}

// ─── Filtering ─────────────────────────────────────────────────────────────────

export function filterByTier(models, tier) {
  if (tier === 'All') return models;
  return models.filter(m => m.tier === tier);
}

export function filterBySearch(models, query) {
  if (!query) return models;
  const q = query.toLowerCase();
  return models.filter(m =>
    `${m.id} ${m.displayName || ''} ${m.providerKey} ${m.tier || ''} ${m.aaIntelligence ?? ''}`.toLowerCase().includes(q)
  );
}

// ─── Sorting ───────────────────────────────────────────────────────────────────

/** Return the first non-zero value from a list of comparator results. */
function firstNonZero(...values) {
  for (const v of values) {
    if (v !== 0) return v;
  }
  return 0;
}

/** Compare two values where Infinity means "no data" and sorts last. */
function cmpWithInfinity(a, b) {
  if (a === Infinity) return b === Infinity ? 0 : 1;
  if (b === Infinity) return -1;
  return a - b;
}

export function sortModels(models, col, asc = true) {
  const dir = asc ? 1 : -1;
  return [...models].sort((a, b) => {
    let cmp = 0;
    switch (col) {
      case 'priority': cmp = cmpPriority(a, b); break;
      case 'rank':
      case 'avg':      cmp = cmpAvg(a, b); break;
      case 'tier':     cmp = (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99); break;
      case 'provider': cmp = a.providerKey.localeCompare(b.providerKey); break;
      case 'model':    cmp = (a.displayName || a.id).localeCompare(b.displayName || b.id); break;
      case 'latest':   cmp = cmpLatest(a, b); break;
      case 'context':  cmp = (a.context || 0) - (b.context || 0); break;
      case 'intel':    cmp = (a.aaIntelligence ?? -1) - (b.aaIntelligence ?? -1); break;
      case 'uptime':   cmp = getUptime(a) - getUptime(b); break;
      case 'verdict':  cmp = verdictRank(getVerdict(a)) - verdictRank(getVerdict(b)); break;
      default:         cmp = cmpAvg(a, b);
    }
    return cmp * dir;
  });
}

function cmpAvg(a, b) {
  return cmpWithInfinity(getAvg(a), getAvg(b));
}

function cmpLatest(a, b) {
  const al = a.pings.at(-1), bl = b.pings.at(-1);
  const am = al?.code === '200' ? al.ms : Infinity;
  const bm = bl?.code === '200' ? bl.ms : Infinity;
  return cmpWithInfinity(am, bm);
}

function cmpPriority(a, b) {
  return firstNonZero(
    (a.status === 'up' ? 0 : 1) - (b.status === 'up' ? 0 : 1),
    (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99),
    cmpAvg(a, b),
    getUptime(b) - getUptime(a),
    (a.providerKey || '').localeCompare(b.providerKey || ''),
    (a.displayName || a.id || '').localeCompare(b.displayName || b.id || ''),
    (a.id || '').localeCompare(b.id || ''),
  );
}

const VERDICT_RANK = {
  '🚀 Perfect': 0, '✅ Normal': 1, '🐢 Slow': 2, '🐌 Very Slow': 3,
  '💀 Unusable': 4, '🔥 Overloaded': 5, '⚠️  Unstable': 6,
  '👻 Not Active': 7, '🚫 Not Found': 8, '⏳ Pending': 9,
};
function verdictRank(v) { return VERDICT_RANK[v] ?? 9; }

// ─── Best model (--best mode) ──────────────────────────────────────────────────

export function findBestModel(models) {
  const candidates = models.filter(m => m.pings.length > 0);
  if (!candidates.length) return null;
  return [...candidates].sort(cmpPriority)[0];
}

// ─── String width (strips ANSI, counts emoji as 2 columns) ─────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const EMOJI_RE = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/u;

export function visLen(s) {
  const stripped = String(s).replace(ANSI_RE, '');
  let width = 0;
  for (const ch of stripped) {
    width += EMOJI_RE.test(ch) ? 2 : 1;
  }
  return width;
}

export function pad(s, n, right = false) {
  const str = String(s);
  const spaces = Math.max(0, n - visLen(str));
  return right ? ' '.repeat(spaces) + str : str + ' '.repeat(spaces);
}
