// lib/ping.js — single ping, parallel batch, continuous re-ping loop
import https from 'node:https';
import http  from 'node:http';
import { getApiKey, PROVIDERS_META } from './config.js';

const TIMEOUT_MS = 15_000;
const MAX_PINGS  = 100; // cap history per model
const PING_CONCURRENCY = 20;

type PingResult = { code: string; ms: number };

// ─── Concurrency limiter ──────────────────────────────────────────────────────
async function pooled(items: any[], limit: number, fn: (item: any) => Promise<any>) {
  const results: any[] = [];
  let i = 0;
  async function next() {
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

    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const t0  = performance.now();
    let done  = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; req.destroy(); resolve({ code: '000', ms: elapsed() }); }
    }, TIMEOUT_MS);

    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'http:' ? 80 : 443),
      path:     url.pathname,
      method:   'POST',
      headers,
    }, (res) => {
      res.on('data', () => {});  // drain to free socket
      res.on('end', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ code: String(res.statusCode), ms: elapsed() });
      });
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: err.code === 'ECONNRESET' ? 'ERR' : 'ERR', ms: elapsed() });
    });

    req.write(body);
    req.end();

    function elapsed() { return Math.round(performance.now() - t0); }
  });
}

/**
 * Ping all models with concurrency limiting and progressive backoff.
 * Mutates each model: .pings[], .status, .httpCode, ._consecutiveFails, ._skipUntilRound
 */
export async function pingAllOnce(models: any[], config: any) {
  _roundCounter++;

  // Filter out models that should be skipped this round (backoff)
  const toPing = models.filter(m => {
    if (!PROVIDERS_META[m.providerKey]) return false;
    // Progressive backoff: after 5 consecutive fails, skip exponentially
    const fails = m._consecutiveFails || 0;
    if (fails >= 5) {
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
    if      (result.code === '200') m.status = 'up';
    else if (result.code === '401') m.status = 'noauth';
    else if (result.code === '404') m.status = 'notfound';
    else if (result.code === '000') m.status = 'timeout';
    else                            m.status = 'down';

    // Track consecutive failures for backoff
    if (result.code === '200' || result.code === '401') {
      m._consecutiveFails = 0;
    } else {
      m._consecutiveFails = (m._consecutiveFails || 0) + 1;
      if (m._consecutiveFails >= 5) {
        const delay = Math.min(32, Math.pow(2, m._consecutiveFails - 5));
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

export function stopPingLoop(ref: { running: boolean; timer: NodeJS.Timeout | null } | null | undefined) {
  if (!ref) return;
  ref.running = false;
  if (ref.timer) clearTimeout(ref.timer);
}
