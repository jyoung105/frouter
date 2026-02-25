// src/lib/ping.ts — single ping, parallel batch, continuous re-ping loop
import http  from 'node:http';
import https from 'node:https';
import { getApiKey, PROVIDERS_META } from './config.js';

const TIMEOUT_MS       = 15_000;
const MAX_PINGS        = 100; // cap history per model
const PING_CONCURRENCY = 20;
const BACKOFF_THRESHOLD = 5;

type PingResult = { code: string; ms: number };

const STATUS_MAP: Record<string, string> = {
  '200': 'up',
  '401': 'noauth',
  '404': 'notfound',
  '000': 'timeout',
};

// ─── Concurrency limiter ──────────────────────────────────────────────────────
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function next(): Promise<void> {
    const idx = i++;
    if (idx >= items.length) return;
    results[idx] = await fn(items[idx]).catch(e => e);
    await next();
  }
  await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, () => next()));
  return results;
}

// ─── Progressive backoff for dead models ──────────────────────────────────────
let _roundCounter = 0;

/**
 * Single minimal chat-completion request to measure round-trip latency.
 * Returns { code: '200'|'401'|'429'|'404'|'000'|'ERR', ms: number }
 *   '000' = timed out (AbortError)
 *   'ERR' = network error (DNS, refused, etc.)
 */
export function ping(apiKey: string | null | undefined, modelId: string, chatUrl: string): Promise<PingResult> {
  return new Promise((resolve) => {
    const url  = new URL(chatUrl);
    const lib  = url.protocol === 'http:' ? http : https;
    const body = JSON.stringify({
      model:      modelId,
      messages:   [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
    });

    const headers: Record<string, string | number> = {
      'Content-Type':   'application/json',
      'Content-Length':  Buffer.byteLength(body),
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const t0 = performance.now();
    function elapsed(): number { return Math.round(performance.now() - t0); }

    let settled = false;
    function settle(code: string): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, ms: elapsed() });
    }

    const timer = setTimeout(() => { settle('000'); req.destroy(); }, TIMEOUT_MS);

    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'http:' ? 80 : 443),
      path:     url.pathname,
      method:   'POST',
      headers,
    }, (res) => {
      res.on('data', () => {});  // drain to free socket
      res.on('end', () => settle(String(res.statusCode)));
    });

    req.on('error', () => settle('ERR'));

    req.write(body);
    req.end();
  });
}

/**
 * Ping all models with concurrency limiting and progressive backoff.
 * Mutates each model: .pings[], .status, .httpCode, ._consecutiveFails, ._skipUntilRound
 */
export async function pingAllOnce(models: any[], config: any) {
  _roundCounter++;

  const toPing = models.filter(m => {
    if (!PROVIDERS_META[m.providerKey]) return false;
    const fails = m._consecutiveFails || 0;
    if (fails >= BACKOFF_THRESHOLD) {
      const skipUntil = m._skipUntilRound || 0;
      if (_roundCounter < skipUntil) return false;
    }
    return true;
  });

  await pooled(toPing, PING_CONCURRENCY, async (m) => {
    const meta   = PROVIDERS_META[m.providerKey];
    const apiKey = getApiKey(config, m.providerKey);
    const result = await ping(apiKey, m.id, meta.chatUrl);

    m.pings.push(result);
    if (m.pings.length > MAX_PINGS) m.pings.shift();

    m.httpCode = result.code;
    m.status   = STATUS_MAP[result.code] || 'down';

    // Track consecutive failures for backoff
    if (result.code === '200' || result.code === '401') {
      m._consecutiveFails = 0;
    } else {
      m._consecutiveFails = (m._consecutiveFails || 0) + 1;
      if (m._consecutiveFails >= BACKOFF_THRESHOLD) {
        const delay = Math.min(32, 2 ** (m._consecutiveFails - BACKOFF_THRESHOLD));
        m._skipUntilRound = _roundCounter + delay;
      }
    }
  });
}

/**
 * Start continuous ping loop. Returns a ref object for stopPingLoop().
 * Fires first round immediately, then repeats every intervalMs.
 * Calls onUpdate() after each completed round.
 */
export function startPingLoop(models: any[], config: any, intervalMs: number, onUpdate?: () => void) {
  const ref = { running: true, timer: null };

  async function tick() {
    if (!ref.running) return;
    await pingAllOnce(models, config);
    onUpdate?.();
    if (ref.running) ref.timer = setTimeout(tick, intervalMs);
  }

  void tick(); // fire immediately, don't await
  return ref;
}

export function stopPingLoop(ref: { running: boolean; timer: NodeJS.Timeout | null } | null | undefined): void {
  if (!ref) return;
  ref.running = false;
  if (ref.timer) clearTimeout(ref.timer);
}
