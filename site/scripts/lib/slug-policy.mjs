function assertNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildIdentityKey(record) {
  return `${record.source}:${record.model_id}`;
}

export function normalizeSlugSegment(value) {
  if (!assertNonEmptyString(value)) {
    return '';
  }

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildCollisionSuffix(record) {
  return `${normalizeSlugSegment(record.source)}-${normalizeSlugSegment(record.model_id)}`;
}

function sortManifestEntries(entries) {
  return [...entries].sort((left, right) => left.key.localeCompare(right.key));
}

export function createSlugManifest(entries) {
  return {
    version: 1,
    models: sortManifestEntries(entries).map((entry) => ({
      key: entry.key,
      source: entry.source,
      modelId: entry.modelId,
      slug: entry.slug,
      canonicalPath: entry.canonicalPath,
      name: entry.name,
    })),
  };
}

export function diffManifestRedirects(previousManifest, nextManifest) {
  const previousByKey = new Map(
    (previousManifest?.models ?? []).map((entry) => [entry.key, entry]),
  );

  return (nextManifest?.models ?? [])
    .map((entry) => {
      const previous = previousByKey.get(entry.key);
      if (!previous || previous.canonicalPath === entry.canonicalPath) {
        return null;
      }

      return {
        source: previous.canonicalPath,
        destination: entry.canonicalPath,
        permanent: true,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.source.localeCompare(right.source));
}

export function resolveCanonicalRecords(models) {
  const datasetErrors = [];
  const recordErrors = [];
  const identityRecords = new Map();
  const usedSlugs = new Map();
  const resolved = [];

  models.forEach((record, index) => {
    const missingCoreFields = ['source', 'model_id', 'name'].filter(
      (field) => !assertNonEmptyString(record[field]),
    );

    if (missingCoreFields.length > 0) {
      datasetErrors.push({
        code: 'missing-core-field',
        index,
        modelId: record.model_id ?? null,
        source: record.source ?? null,
        details: `Missing required field(s): ${missingCoreFields.join(', ')}`,
      });
      return;
    }

    const key = buildIdentityKey(record);
    if (identityRecords.has(key)) {
      const previousRecord = identityRecords.get(key);
      if (JSON.stringify(previousRecord.record) === JSON.stringify(record)) {
        recordErrors.push({
          code: 'duplicate-record-skipped',
          index,
          modelId: record.model_id,
          source: record.source,
          details: `Skipped an identical duplicate for ${key}`,
        });
        return;
      }

      datasetErrors.push({
        code: 'duplicate-identity',
        index,
        modelId: record.model_id,
        source: record.source,
        details: `Duplicate identity key ${key} has conflicting records`,
      });
      return;
    }

    identityRecords.set(key, { index, record });

    const baseSlug =
      normalizeSlugSegment(record.aa_slug) || normalizeSlugSegment(record.name);

    if (!baseSlug) {
      datasetErrors.push({
        code: 'empty-canonical-slug',
        index,
        modelId: record.model_id,
        source: record.source,
        details: 'Unable to derive a canonical slug from aa_slug or name',
      });
      return;
    }

    let slug = baseSlug;
    if (usedSlugs.has(slug)) {
      slug = `${baseSlug}--${buildCollisionSuffix(record)}`;
    }

    if (!slug || usedSlugs.has(slug)) {
      datasetErrors.push({
        code: 'unresolved-slug-collision',
        index,
        modelId: record.model_id,
        source: record.source,
        details: `Unable to create a unique slug for ${key}`,
      });
      return;
    }

    usedSlugs.set(slug, key);

    resolved.push({
      ...record,
      key,
      slug,
      canonicalPath: `/models/${slug}/`,
      rowIndex: index,
    });

    if (!assertNonEmptyString(record.tier) || !assertNonEmptyString(record.context)) {
      recordErrors.push({
        code: 'missing-display-metadata',
        index,
        modelId: record.model_id,
        source: record.source,
        details: 'Tier or context is missing; page would render incomplete stats',
      });
    }
  });

  return {
    datasetErrors,
    recordErrors,
    records: resolved,
    manifest: createSlugManifest(
      resolved.map((entry) => ({
        key: entry.key,
        source: entry.source,
        modelId: entry.model_id,
        slug: entry.slug,
        canonicalPath: entry.canonicalPath,
        name: entry.name,
      })),
    ),
  };
}
