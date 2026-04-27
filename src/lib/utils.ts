// src/lib/utils.ts — sort, filter, search, verdict, tier logic, ANSI color helpers

// ─── ANSI ──────────────────────────────────────────────────────────────────────
export const R = "\x1b[0m"; // reset
export const B = "\x1b[1m"; // bold
export const D = "\x1b[2m"; // dim
export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const CYAN = "\x1b[36m";
export const WHITE = "\x1b[37m";
export const ORANGE = "\x1b[38;5;208m";
export const BG_SEL = "\x1b[48;5;235m"; // subtle selection highlight

export function readEnv(name: string, legacyName?: string): string | undefined {
  return process.env[name] ?? (legacyName ? process.env[legacyName] : undefined);
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export type PingEntry = { code: string; ms: number; detail?: string };

export type ModelMetrics = {
  version: number;
  count: number;
  okCount: number;
  sumOkMs: number;
};

export type Model = {
  id: string;
  displayName: string;
  context: number;
  providerKey: string;
  sweScore: number | null;
  tier: string;
  aaIntelligence: number | null;
  aaSpeedTps: number | null;
  opencodeSupported: boolean | null;
  pings: PingEntry[];
  status: string;
  httpCode: string | null;
  _metrics?: ModelMetrics;
  _consecutiveFails?: number;
  _skipUntilRound?: number;
  _seqEpoch?: number;
  _nextSeq?: number;
  _lastCommitEpoch?: number;
  _lastCommitSeq?: number;
  _staleCommitDrops?: number;
};

// ─── Tier order ────────────────────────────────────────────────────────────────
export const TIER_CYCLE = ["All", "S+", "S", "A+", "A", "A-", "B+", "B", "C"];
export const TIER_ORDER: Record<string, number> = {
  "S+": 0,
  S: 1,
  "A+": 2,
  A: 3,
  "A-": 4,
  "B+": 5,
  B: 6,
  C: 7,
};

// ─── Rolling metrics cache ────────────────────────────────────────────────────

const METRICS_CACHE_VERSION = 1;
const METRICS_CACHE_ENABLED =
  readEnv("FREE_ROUTER_METRICS_CACHE", "FROUTER_METRICS_CACHE") !== "0";

function emptyMetrics(): ModelMetrics {
  return {
    version: METRICS_CACHE_VERSION,
    count: 0,
    okCount: 0,
    sumOkMs: 0,
  };
}

function isFiniteMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isReachablePing(ping: PingEntry): boolean {
  return (ping?.code === "200" || ping?.code === "401") && isFiniteMs(ping?.ms);
}

function recomputeMetricsFromPings(pings: PingEntry[]): ModelMetrics {
  const metrics = emptyMetrics();
  for (const ping of pings) {
    metrics.count++;
    if (isReachablePing(ping)) {
      metrics.okCount++;
      metrics.sumOkMs += ping.ms;
    }
  }
  return metrics;
}

function hasValidMetrics(model: Model): boolean {
  const m = model?._metrics;
  return (
    !!m &&
    m.version === METRICS_CACHE_VERSION &&
    Number.isInteger(m.count) &&
    Number.isInteger(m.okCount) &&
    isFiniteMs(m.sumOkMs) &&
    m.count >= 0 &&
    m.okCount >= 0 &&
    m.okCount <= m.count
  );
}

function ensureMetrics(model: Model): ModelMetrics | null {
  if (!METRICS_CACHE_ENABLED) return null;
  if (!Array.isArray(model.pings)) model.pings = [];
  if (!hasValidMetrics(model)) {
    model._metrics = recomputeMetricsFromPings(model.pings);
  }
  return model._metrics ?? null;
}

export function isMetricsCacheEnabled(): boolean {
  return METRICS_CACHE_ENABLED;
}

export function rebuildModelMetrics(model: Model): ModelMetrics | null {
  if (!Array.isArray(model.pings)) model.pings = [];
  if (!METRICS_CACHE_ENABLED) {
    delete model._metrics;
    return null;
  }
  model._metrics = recomputeMetricsFromPings(model.pings);
  return model._metrics;
}

export function applyModelPingResult(
  model: Model,
  pingResult: PingEntry,
  maxPings: number,
): void {
  if (!Array.isArray(model.pings)) model.pings = [];
  const metrics = ensureMetrics(model);

  model.pings.push(pingResult);
  if (metrics) {
    metrics.count++;
    if (isReachablePing(pingResult)) {
      metrics.okCount++;
      metrics.sumOkMs += pingResult.ms;
    }
  }

  const excess = model.pings.length - maxPings;
  if (excess > 0) {
    const removed = model.pings.splice(0, excess);
    if (metrics) {
      for (const r of removed) {
        metrics.count = Math.max(0, metrics.count - 1);
        if (isReachablePing(r)) {
          metrics.okCount = Math.max(0, metrics.okCount - 1);
          metrics.sumOkMs -= r.ms;
        }
      }
    }
  }
}

export function assertModelMetricsInvariant(model: Model): {
  ok: boolean;
  reason?: string;
} {
  if (!METRICS_CACHE_ENABLED) return { ok: true };
  const metrics = ensureMetrics(model);
  const oracle = recomputeMetricsFromPings(
    Array.isArray(model.pings) ? model.pings : [],
  );
  if (!metrics) return { ok: false, reason: "metrics missing" };
  if (metrics.count !== oracle.count) {
    return {
      ok: false,
      reason: `count mismatch cache=${metrics.count} oracle=${oracle.count}`,
    };
  }
  if (metrics.okCount !== oracle.okCount) {
    return {
      ok: false,
      reason: `okCount mismatch cache=${metrics.okCount} oracle=${oracle.okCount}`,
    };
  }
  if (metrics.sumOkMs !== oracle.sumOkMs) {
    return {
      ok: false,
      reason: `sumOkMs mismatch cache=${metrics.sumOkMs} oracle=${oracle.sumOkMs}`,
    };
  }
  return { ok: true };
}

// ─── Stats ─────────────────────────────────────────────────────────────────────

/** Average latency from HTTP 200 pings only. Returns Infinity if none yet. */
export function getAvg(model: Model): number {
  const metrics = ensureMetrics(model);
  if (metrics) {
    if (!metrics.okCount) return Infinity;
    return metrics.sumOkMs / metrics.okCount;
  }
  const ok = model.pings.filter(
    (p: PingEntry) => p.code === "200" || p.code === "401",
  );
  if (!ok.length) return Infinity;
  return ok.reduce((s: number, p: PingEntry) => s + p.ms, 0) / ok.length;
}

/** Uptime % = HTTP 200 pings / total pings x 100. */
export function getUptime(model: Model): number {
  const metrics = ensureMetrics(model);
  if (metrics) {
    if (!metrics.count) return 0;
    return Math.round((metrics.okCount / metrics.count) * 100);
  }
  if (!model.pings.length) return 0;
  return Math.round(
    (model.pings.filter(isReachablePing).length / model.pings.length) * 100,
  );
}

// ─── Verdict ───────────────────────────────────────────────────────────────────

/** Strict-priority verdict for a model (conditions before latency). */
export function getVerdict(model: Model): string {
  const last = model.pings.at(-1);
  const avg = getAvg(model);
  const metrics = ensureMetrics(model);
  const everUp = metrics
    ? metrics.okCount > 0
    : model.pings.some((p: PingEntry) => p.code === "200");

  if (model.status === "ratelimit" || last?.code === "429")
    return "🔥 Overloaded";
  if (model.status === "unavailable") return "🛑 Unavailable";
  if (model.status === "forbidden") return "⛔ Forbidden";
  if (everUp && model.status !== "up" && model.status !== "noauth")
    return "⚠️  Unstable";
  if (model.status === "notfound") return "🚫 Not Found";
  if (!everUp && model.pings.length > 0 && model.status !== "pending")
    return "👻 Not Active";
  if (avg === Infinity) return "⏳ Pending";
  if (avg < 400) return "🚀 Perfect";
  if (avg < 1000) return "✅ Normal";
  if (avg < 3000) return "🐢 Slow";
  if (avg < 5000) return "🐌 Very Slow";
  return "💀 Unusable";
}

// ─── Color helpers ─────────────────────────────────────────────────────────────

export function tierColor(tier: string): string {
  if (tier === "S+" || tier === "S") return WHITE + B;
  if (tier?.startsWith("A")) return YELLOW;
  if (tier === "B+" || tier === "B") return ORANGE;
  return RED;
}

export function latColor(ms: number): string {
  if (ms < 500) return GREEN;
  if (ms < 1500) return YELLOW;
  return RED;
}

export function uptimeColor(pct: number): string {
  if (pct >= 90) return GREEN;
  if (pct >= 70) return YELLOW;
  if (pct >= 50) return ORANGE;
  return RED;
}

// ─── Filtering ─────────────────────────────────────────────────────────────────

export function filterByTier(models: Model[], tier: string): Model[] {
  if (tier === "All") return models;
  return models.filter((m) => m.tier === tier);
}

export function filterBySearch(models: Model[], query: string): Model[] {
  if (!query) return models;
  const q = query.toLowerCase();
  return models.filter((m: Model) =>
    `${m.id} ${m.displayName || ""}`.toLowerCase().includes(q),
  );
}

// ─── Sorting ───────────────────────────────────────────────────────────────────

/** Return the first non-zero value from a list of comparator results. */
function firstNonZero(...values: number[]): number {
  for (const v of values) {
    if (v !== 0) return v;
  }
  return 0;
}

/** Compare two values where Infinity means "no data" and sorts last. */
function cmpWithInfinity(a: number, b: number): number {
  if (a === Infinity) return b === Infinity ? 0 : 1;
  if (b === Infinity) return -1;
  return a - b;
}

export function sortModels(models: Model[], col: string, asc = true): Model[] {
  const dir = asc ? 1 : -1;
  return [...models].sort((a, b) => {
    let cmp: number;
    switch (col) {
      case "priority":
        cmp = cmpPriority(a, b);
        break;
      case "rank":
      case "avg":
        cmp = cmpAvg(a, b);
        break;
      case "tier":
        cmp = (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99);
        break;
      case "provider":
        cmp = a.providerKey.localeCompare(b.providerKey);
        break;
      case "model":
        cmp = (a.displayName || a.id).localeCompare(b.displayName || b.id);
        break;
      case "latest":
        cmp = cmpLatest(a, b);
        break;
      case "context":
        cmp = (a.context || 0) - (b.context || 0);
        break;
      case "intel":
        cmp = (a.aaIntelligence ?? -1) - (b.aaIntelligence ?? -1);
        break;
      case "uptime":
        cmp = getUptime(a) - getUptime(b);
        break;
      case "verdict":
        cmp = verdictRank(getVerdict(a)) - verdictRank(getVerdict(b));
        break;
      default:
        cmp = cmpAvg(a, b);
    }
    // Stable tie-breaking: models with equal primary key sort deterministically by ID.
    if (cmp === 0) cmp = (a.id || "").localeCompare(b.id || "");
    return cmp * dir;
  });
}

function cmpAvg(a: Model, b: Model): number {
  return cmpWithInfinity(getAvg(a), getAvg(b));
}

function cmpLatest(a: Model, b: Model): number {
  const al = a.pings.at(-1),
    bl = b.pings.at(-1);
  const am = al?.code === "200" ? al.ms : Infinity;
  const bm = bl?.code === "200" ? bl.ms : Infinity;
  return cmpWithInfinity(am, bm);
}

function cmpPriority(a: Model, b: Model): number {
  return firstNonZero(
    (a.status === "up" ? 0 : 1) - (b.status === "up" ? 0 : 1),
    (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99),
    cmpAvg(a, b),
    getUptime(b) - getUptime(a),
    (a.providerKey || "").localeCompare(b.providerKey || ""),
    (a.displayName || a.id || "").localeCompare(b.displayName || b.id || ""),
    (a.id || "").localeCompare(b.id || ""),
  );
}

const VERDICT_RANK: Record<string, number> = {
  "🚀 Perfect": 0,
  "✅ Normal": 1,
  "🐢 Slow": 2,
  "🐌 Very Slow": 3,
  "💀 Unusable": 4,
  "🔥 Overloaded": 5,
  "🛑 Unavailable": 6,
  "⛔ Forbidden": 7,
  "⚠️  Unstable": 8,
  "👻 Not Active": 9,
  "🚫 Not Found": 10,
  "⏳ Pending": 11,
};
function verdictRank(v: string): number {
  return VERDICT_RANK[v] ?? 11;
}

// ─── Best model (--best mode) ──────────────────────────────────────────────────

export function findBestModel(models: Model[]): Model | null {
  const candidates = models.filter((m: Model) => m.pings.length > 0);
  if (!candidates.length) return null;
  return [...candidates].sort(cmpPriority)[0];
}

// ─── String width (strips ANSI, counts emoji as 2 columns) ─────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const EMOJI_RE =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/u;
const WIDE_EMOJI_RE =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
const GRAPHEME_SEGMENTER =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function splitGraphemes(s: string): string[] {
  const str = String(s);
  if (!str) return [];
  if (GRAPHEME_SEGMENTER) {
    return Array.from(
      GRAPHEME_SEGMENTER.segment(str),
      ({ segment }) => segment,
    );
  }
  return Array.from(str);
}

export function visibleWidth(s: string): number {
  const str = String(s);
  if (!str) return 0;
  if (/^[\x00-\x7f]+$/.test(str)) return str.length;
  return WIDE_EMOJI_RE.test(str) ? 2 : 1;
}

export function truncAnsiToWidth(s: string, maxVis: number): string {
  let vis = 0;
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\x1b") {
      const start = i;
      i++;
      if (i < s.length && s[i] === "[") {
        i++;
        while (i < s.length && s[i] >= "\x20" && s[i] <= "\x3f") i++;
        if (i < s.length) i++;
      }
      out += s.slice(start, i);
      continue;
    }

    // Collect the text run until the next ANSI escape, then segment it once
    let textEnd = i;
    while (textEnd < s.length && s[textEnd] !== "\x1b") textEnd++;
    const textRun = s.slice(i, textEnd);
    for (const segment of splitGraphemes(textRun)) {
      const w = visibleWidth(segment);
      if (vis + w > maxVis) return out;
      out += segment;
      vis += w;
    }
    i = textEnd;
  }
  return out;
}

export function visLen(s: string): number {
  const stripped = String(s).replace(ANSI_RE, "");
  if (!/[^\x00-\x7f]/.test(stripped)) return stripped.length;
  let width = 0;
  for (const segment of splitGraphemes(stripped)) {
    width += visibleWidth(segment);
  }
  return width;
}

export function pad(s: string, n: number, right = false): string {
  const str = String(s);
  const spaces = Math.max(0, n - visLen(str));
  return right ? " ".repeat(spaces) + str : str + " ".repeat(spaces);
}
