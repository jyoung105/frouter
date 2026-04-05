import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIdentityKey,
  diffManifestRedirects,
  normalizeSlugSegment,
  resolveCanonicalRecords,
} from '../scripts/lib/slug-policy.mjs';

test('normalizeSlugSegment strips diacritics and punctuation', () => {
  assert.equal(normalizeSlugSegment('  Ágent / Model++  '), 'agent-model');
});

test('buildIdentityKey composes source and model id', () => {
  assert.equal(
    buildIdentityKey({ source: 'nim', model_id: 'z-ai/glm5' }),
    'nim:z-ai/glm5',
  );
});

test('resolveCanonicalRecords suffixes duplicate canonical slugs deterministically', () => {
  const resolution = resolveCanonicalRecords([
    { source: 'nim', model_id: 'one', name: 'Alpha', aa_slug: 'shared' },
    { source: 'openrouter', model_id: 'two/model', name: 'Alpha', aa_slug: 'shared' },
  ]);

  assert.equal(resolution.datasetErrors.length, 0);
  assert.deepEqual(
    resolution.records.map((record) => record.slug),
    ['shared', 'shared--openrouter-two-model'],
  );
});

test('diffManifestRedirects returns only changed canonical paths', () => {
  const redirects = diffManifestRedirects(
    {
      version: 1,
      models: [
        {
          key: 'nim:one',
          canonicalPath: '/models/old/',
        },
      ],
    },
    {
      version: 1,
      models: [
        {
          key: 'nim:one',
          canonicalPath: '/models/new/',
        },
      ],
    },
  );

  assert.deepEqual(redirects, [
    {
      source: '/models/old/',
      destination: '/models/new/',
      permanent: true,
    },
  ]);
});
