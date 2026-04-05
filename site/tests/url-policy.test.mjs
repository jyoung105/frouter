import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalPathSerializer,
  normalizeBasePath,
  redirectMatcher,
  resolveBuildContext,
  sitemapUrlBuilder,
  validateBuildContext,
} from '../scripts/lib/url-policy.mjs';

test('normalizeBasePath preserves slash-wrapped subpaths', () => {
  assert.equal(normalizeBasePath('/sub/path'), '/sub/path/');
});

test('canonicalPathSerializer applies base path and trailing slash', () => {
  assert.equal(canonicalPathSerializer('/models/foo', '/sub/'), '/sub/models/foo/');
});

test('redirectMatcher returns slashless matcher form', () => {
  assert.equal(redirectMatcher('/models/foo/', '/'), '/models/foo');
});

test('resolveBuildContext requires preview origins from preview env', () => {
  const context = resolveBuildContext({
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'preview.example.vercel.app',
  });

  assert.equal(context.mode, 'preview');
  assert.equal(context.origin, 'https://preview.example.vercel.app');
  assert.equal(context.robotsContent, 'noindex, nofollow');
});

test('validateBuildContext rejects insecure production origins', () => {
  const errors = validateBuildContext({
    mode: 'production',
    origin: 'http://example.com',
  });

  assert.deepEqual(errors, ['Production SITE_URL must be HTTPS']);
});

test('sitemapUrlBuilder emits absolute URLs', () => {
  const url = sitemapUrlBuilder('/models/foo/', {
    origin: 'https://example.com',
    basePath: '/docs/',
  });

  assert.equal(url, 'https://example.com/docs/models/foo/');
});
