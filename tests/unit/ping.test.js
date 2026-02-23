import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createHttpServer } from '../helpers/mock-http.js';
import { ping } from '../../lib/ping.js';

test('ping sends Authorization header when API key is provided', async () => {
  let authHeader = null;
  const server = await createHttpServer((req, res) => {
    authHeader = req.headers.authorization ?? null;
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  try {
    const result = await ping('secret-key', 'demo/model', `${server.baseUrl}/chat/completions`);
    assert.equal(result.code, '200');
    assert.equal(authHeader, 'Bearer secret-key');
  } finally {
    await server.close();
  }
});

test('ping omits Authorization header when API key is missing', async () => {
  let authHeader = 'not-checked';
  const server = await createHttpServer((req, res) => {
    authHeader = req.headers.authorization ?? null;
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  try {
    const result = await ping(null, 'demo/model', `${server.baseUrl}/chat/completions`);
    assert.equal(result.code, '200');
    assert.equal(authHeader, null);
  } finally {
    await server.close();
  }
});

test('ping returns ERR on network connection failure', async () => {
  // Reserve an ephemeral port, then close it to guarantee connection refusal.
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const addr = probe.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  await new Promise((resolve, reject) => probe.close((err) => (err ? reject(err) : resolve())));

  const result = await ping(null, 'demo/model', `http://127.0.0.1:${port}/chat/completions`);
  assert.equal(result.code, 'ERR');
});
