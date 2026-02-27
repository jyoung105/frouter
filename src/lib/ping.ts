// src/lib/ping.ts — single ping, parallel batch, continuous re-ping loop
import http from "node:http";
import https from "node:https";
import { getApiKey, PROVIDERS_META } from "./config.js";
import { TIER_ORDER } from "./utils.js";

const TIMEOUT_MS = 6_000; // steady-state ping timeout
const INITIAL_TIMEOUT_MS = 2_500; // faster first-pass to clear pending sooner
const MAX_PINGS = 100; // cap history per model
const PING_CONCURRENCY = 20; // steady-state concurrency
const INITIAL_PING_CONCURRENCY = 64; // first-pass concurrency for pending models
const BACKOFF_THRESHOLD = 3; // Phase 2F: lowered from 5 — stop wasting slots sooner

type PingResult = { code: string; ms: number; detail?: string };
type PingOptions = { timeoutMs?: number };

const STATUS_MAP: Record<string, string> = {
  "200": "up",
  "401": "noauth",
  "404": "notfound",
  "429": "ratelimit", // Phase 2E: distinguish rate-limited (alive but busy)
  "000": "timeout",
  "503": "unavailable", // Phase 2E: service unavailable
};

// ─── Keep-alive agents per hostname (Phase 2D) ──────────────────────────────
const _agents = new Map<string, http.Agent | https.Agent>();

function getKeepAliveAgent(url: URL): http.Agent | https.Agent {
  const key = `${url.protocol}//${url.hostname}:${url.port || (url.protocol === "http:" ? 80 : 443)}`;
  let agent = _agents.get(key);
  if (!agent) {
    const Ctor = url.protocol === "http:" ? http.Agent : https.Agent;
    agent = new Ctor({
      keepAlive: true,
      maxSockets: Math.max(PING_CONCURRENCY, INITIAL_PING_CONCURRENCY),
      timeout: TIMEOUT_MS,
    });
    _agents.set(key, agent);
  }
  return agent;
}

// ─── Concurrency limiter with per-item callback (Phase 3G) ──────────────────
async function pooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  onEach?: (item: T, result: R, index: number) => void,
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function next(): Promise<void> {
    const idx = i++;
    if (idx >= items.length) return;
    const result = await fn(items[idx]).catch((e) => e);
    results[idx] = result;
    onEach?.(items[idx], result, idx);
    await next();
  }
  await Promise.allSettled(
    Array.from({ length: Math.min(limit, items.length) }, () => next()),
  );
  return results;
}

// ─── Progressive backoff for dead models ──────────────────────────────────────
let _roundCounter = 0;


/**
 * Single minimal chat-completion request to measure TTFB latency.
 * Returns { code: '200'|'401'|'429'|'404'|'000'|'ERR', ms: number, detail?: string }
 *   '000' = timed out
 *   'ERR' = network error (DNS, refused, etc.) — detail has the error code
 */
export function ping(
  apiKey: string | null | undefined,
  modelId: string,
  chatUrl: string,
  options: PingOptions = {},
): Promise<PingResult> {
  return new Promise((resolve) => {
    const requestedTimeout = options.timeoutMs;
    const timeoutMs =
      Number.isFinite(requestedTimeout) && requestedTimeout > 0
        ? Math.round(requestedTimeout)
        : TIMEOUT_MS;
    const url = new URL(chatUrl);
    const lib = url.protocol === "http:" ? http : https;
    const body = JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    });

    const headers: Record<string, string | number> = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const t0 = performance.now();
    function elapsed(): number {
      return Math.round(performance.now() - t0);
    }

    let settled = false;
    function settle(code: string, detail?: string): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, ms: elapsed(), ...(detail ? { detail } : {}) });
    }

    const timer = setTimeout(() => {
      settle("000");
      req.destroy();
    }, timeoutMs);

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "http:" ? 80 : 443),
        path: url.pathname,
        method: "POST",
        headers,
        agent: getKeepAliveAgent(url), // Phase 2D: reuse connections
      },
      (res) => {
        // Phase 1A: settle on TTFB — status code is available immediately
        settle(String(res.statusCode));
        res.resume(); // drain remaining data to free the socket back to the agent pool
      },
    );

    // Phase 4J: capture error code for diagnostics
    req.on("error", (err: NodeJS.ErrnoException) =>
      settle("ERR", err.code || err.message),
    );

    req.write(body);
    req.end();
  });
}

/**
 * Ping all models with concurrency limiting, progressive backoff,
 * and per-ping callback for progressive rendering.
 * Mutates each model: .pings[], .status, .httpCode, ._consecutiveFails, ._skipUntilRound
 */
export async function pingAllOnce(
  models: any[],
  config: any,
  onEachPing?: () => void,
) {
  _roundCounter++;

  const toPing = models.filter((m) => {
    if (!PROVIDERS_META[m.providerKey]) return false;
    const fails = m._consecutiveFails || 0;
    if (fails >= BACKOFF_THRESHOLD) {
      const skipUntil = m._skipUntilRound || 0;
      if (_roundCounter < skipUntil) return false;
    }
    return true;
  });

  // Phase 3H: sort by tier priority — S+ models get pinged first
  toPing.sort(
    (a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99),
  );

  const pendingFirstPass = toPing.filter(
    (m) => !Array.isArray(m.pings) || m.pings.length === 0,
  );
  const steadyState = toPing.filter(
    (m) => Array.isArray(m.pings) && m.pings.length > 0,
  );

  async function runPing(m: any, timeoutMs: number) {
    const meta = PROVIDERS_META[m.providerKey];
    const apiKey = getApiKey(config, m.providerKey);
    const result = await ping(apiKey, m.id, meta.chatUrl, { timeoutMs });

    m.pings.push(result);
    if (m.pings.length > MAX_PINGS) m.pings.shift();

    m.httpCode = result.code;
    m.status = STATUS_MAP[result.code] || "down";

    // Track consecutive failures for backoff
    if (result.code === "200" || result.code === "401") {
      m._consecutiveFails = 0;
    } else {
      m._consecutiveFails = (m._consecutiveFails || 0) + 1;
      if (m._consecutiveFails >= BACKOFF_THRESHOLD) {
        const delay = Math.min(
          32,
          2 ** (m._consecutiveFails - BACKOFF_THRESHOLD),
        );
        m._skipUntilRound = _roundCounter + delay;
      }
    }
  }

  await pooled(
    pendingFirstPass,
    INITIAL_PING_CONCURRENCY,
    (m) => runPing(m, INITIAL_TIMEOUT_MS),
    () => {
      // Phase 3G: fire callback after each individual ping completes
      onEachPing?.();
    },
  );

  await pooled(
    steadyState,
    PING_CONCURRENCY,
    (m) => runPing(m, TIMEOUT_MS),
    () => {
      // Phase 3G: fire callback after each individual ping completes
      onEachPing?.();
    },
  );
}

/**
 * Start continuous ping loop. Returns a ref object for stopPingLoop().
 * Fires first round immediately, then repeats every intervalMs.
 * Calls onUpdate() after each completed round, and onEachPing() after each individual ping.
 */
export function startPingLoop(
  models: any[],
  config: any,
  intervalMs: number,
  onUpdate?: () => void,
  onEachPing?: () => void,
) {
  const ref = { running: true, timer: null };

  async function tick() {
    if (!ref.running) return;
    await pingAllOnce(models, config, onEachPing);
    onUpdate?.();
    if (ref.running) ref.timer = setTimeout(tick, intervalMs);
  }

  void tick(); // fire immediately, don't await
  return ref;
}

export function stopPingLoop(
  ref: { running: boolean; timer: NodeJS.Timeout | null } | null | undefined,
): void {
  if (!ref) return;
  ref.running = false;
  if (ref.timer) clearTimeout(ref.timer);
}

/** Destroy all keep-alive agents (for clean shutdown / tests). */
export function destroyAgents(): void {
  for (const agent of _agents.values()) agent.destroy();
  _agents.clear();
}
