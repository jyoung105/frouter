import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSlugManifest,
  diffManifestRedirects,
  resolveCanonicalRecords,
} from './lib/slug-policy.mjs';
import {
  canonicalPathSerializer,
  resolveBuildContext,
  sitemapUrlBuilder,
  validateBuildContext,
} from './lib/url-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(siteRoot, '..');

const INDEX_TEMPLATE_PATH = path.join(siteRoot, 'index.template.html');
const GENERATED_INDEX_PATH = path.join(siteRoot, 'index.html');
const GENERATED_MODELS_DIR = path.join(siteRoot, 'models');
const GENERATED_PUBLIC_DIR = path.join(siteRoot, 'public');
const GENERATED_STATE_DIR = path.join(siteRoot, '.generated');
const DATA_PATH = path.join(repoRoot, 'data', 'model-rankings.json');
const MANIFEST_PATH = path.join(repoRoot, 'data', 'slug-manifest.json');

const HOME_TITLE = 'free-router | Free AI model router for agents';
const HOME_DESCRIPTION =
  'Browse free AI coding models, compare benchmark signals, and route requests through the fastest free providers with free-router.';

const ALLOWED_BOTS = ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'PerplexityBot'];
const BLOCKED_BOTS = ['GPTBot', 'Google-Extended'];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatValue(value, fallback = 'Unknown') {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  return String(value);
}

function providerLabel(source) {
  return source === 'nim' ? 'NVIDIA NIM' : source === 'openrouter' ? 'OpenRouter' : source;
}

function readJsonFile(filePath, label) {
  return readFile(filePath, 'utf8')
    .then((contents) => JSON.parse(contents))
    .catch((error) => {
      throw new Error(`Unable to read ${label}: ${error.message}`);
    });
}

function buildHomeJsonLd(records, absoluteUrl) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: 'free-router',
        url: absoluteUrl,
        description: HOME_DESCRIPTION,
      },
      {
        '@type': 'Organization',
        name: 'free-router',
        url: absoluteUrl,
      },
      {
        '@type': 'ItemList',
        name: 'Free coding models on free-router',
        itemListOrder: 'https://schema.org/ItemListOrderAscending',
        numberOfItems: records.length,
        itemListElement: records.map((record, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: record.absoluteUrl,
          name: record.name,
        })),
      },
    ],
  };
}

function buildModelJsonLd(record, homeUrl) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: `${record.name} on free-router`,
        url: record.absoluteUrl,
        description: record.description,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: homeUrl,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Models',
            item: `${homeUrl}#models`,
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: record.name,
            item: record.absoluteUrl,
          },
        ],
      },
    ],
  };
}

function buildHeadMarkup({
  canonicalUrl,
  description,
  jsonLd,
  robotsContent,
  title,
  type,
}) {
  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const escapedCanonical = escapeHtml(canonicalUrl);

  return [
    `<title>${escapedTitle}</title>`,
    `<meta name="description" content="${escapedDescription}" />`,
    `<meta name="robots" content="${escapeHtml(robotsContent)}" />`,
    `<link rel="canonical" href="${escapedCanonical}" />`,
    '<meta property="og:site_name" content="free-router" />',
    `<meta property="og:type" content="${escapeHtml(type)}" />`,
    `<meta property="og:title" content="${escapedTitle}" />`,
    `<meta property="og:description" content="${escapedDescription}" />`,
    `<meta property="og:url" content="${escapedCanonical}" />`,
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${escapedTitle}" />`,
    `<meta name="twitter:description" content="${escapedDescription}" />`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
  ].join('\n    ');
}

function buildModelRow(record) {
  const searchCorpus = [
    record.model_id,
    record.name,
    record.source,
    record.tier,
    record.context,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return `<tr data-model-row data-tier="${escapeHtml(record.tier)}" data-search="${escapeHtml(searchCorpus)}">
              <td class="td-tier ${escapeHtml(record.tierClass)}">${escapeHtml(record.tier)}</td>
              <td class="td-src">${escapeHtml(record.sourceShort)}</td>
              <td class="td-name"><a class="model-link" href="models/${escapeHtml(record.slug)}/">${escapeHtml(record.name)}</a></td>
              <td class="td-ctx">${escapeHtml(record.context)}</td>
              <td class="td-swe">${escapeHtml(record.sweDisplay)}</td>
              <td class="td-intel">${escapeHtml(record.intelDisplay)}</td>
              <td class="td-speed">${escapeHtml(record.speedDisplay)}</td>
            </tr>`;
}

function buildModelPage(record, context, homeUrl) {
  const headMarkup = buildHeadMarkup({
    canonicalUrl: record.absoluteUrl,
    description: record.description,
    jsonLd: buildModelJsonLd(record, homeUrl),
    robotsContent: context.robotsContent,
    title: `${record.name} free model routing | free-router`,
    type: 'article',
  });

  const directAiSource =
    record.aa_url && record.aa_url.startsWith('http')
      ? `<a href="${escapeHtml(record.aa_url)}" target="_blank" rel="noopener">Artificial Analysis reference</a>`
      : '<span>Artificial Analysis reference unavailable</span>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/x-icon" href="../../favicon.ico" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/src/style.css" />
    ${headMarkup}
  </head>
  <body>
    <main class="model-page">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <a href="../../">Home</a>
        <span>/</span>
        <a href="../../#models">Models</a>
        <span>/</span>
        <span aria-current="page">${escapeHtml(record.name)}</span>
      </nav>

      <section class="detail-hero">
        <div class="detail-copy">
          <p class="detail-kicker">Free model profile</p>
          <h1>${escapeHtml(record.name)}</h1>
          <p class="detail-summary">${escapeHtml(record.description)}</p>
          <div class="hero-actions">
            <a href="../../#models" class="btn-primary">Back to model index</a>
            <a href="https://github.com/jyoung105/free-router" target="_blank" rel="noopener" class="btn-secondary">Open GitHub</a>
          </div>
        </div>
        <div class="detail-install">
          <div class="terminal detail-terminal">
            <div class="title-bar">
              <div class="controls">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
              <span class="title">${escapeHtml(record.name)} route</span>
              <div class="controls-spacer"></div>
            </div>
            <div class="body">
              <div class="line prompt"><span class="ps1">$</span> free-router --best</div>
              <div class="line output indent">${escapeHtml(record.name)}</div>
              <div class="line output indent dim">${escapeHtml(record.model_id)}</div>
              <div class="spacer"></div>
              <div class="line prompt"><span class="ps1">$</span> provider</div>
              <div class="line output indent">${escapeHtml(record.sourceLabel)}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="detail-grid">
        <article class="detail-card">
          <h2>Routing stats</h2>
          <dl class="stat-grid">
            <div><dt>Provider</dt><dd>${escapeHtml(record.sourceLabel)}</dd></div>
            <div><dt>Tier</dt><dd>${escapeHtml(record.tier)}</dd></div>
            <div><dt>Context</dt><dd>${escapeHtml(record.context)}</dd></div>
            <div><dt>SWE</dt><dd>${escapeHtml(record.sweDisplay)}</dd></div>
            <div><dt>IQ</dt><dd>${escapeHtml(record.intelDisplay)}</dd></div>
            <div><dt>TPS</dt><dd>${escapeHtml(record.speedDisplay)}</dd></div>
          </dl>
        </article>

        <article class="detail-card">
          <h2>Canonical identifiers</h2>
          <dl class="meta-list">
            <div><dt>Model ID</dt><dd>${escapeHtml(record.model_id)}</dd></div>
            <div><dt>Canonical path</dt><dd>${escapeHtml(record.canonicalPath)}</dd></div>
            <div><dt>Absolute URL</dt><dd><a href="${escapeHtml(record.absoluteUrl)}">${escapeHtml(record.absoluteUrl)}</a></dd></div>
            <div><dt>Data source</dt><dd>${directAiSource}</dd></div>
          </dl>
        </article>
      </section>
    </main>
  </body>
</html>
`;
}

function buildRobotsTxt(context) {
  const lines = ['# free-router crawler policy'];

  for (const bot of ALLOWED_BOTS) {
    lines.push(`User-agent: ${bot}`);
    lines.push('Allow: /');
    lines.push('');
  }

  for (const bot of BLOCKED_BOTS) {
    lines.push(`User-agent: ${bot}`);
    lines.push('Disallow: /');
    lines.push('');
  }

  lines.push('User-agent: *');
  lines.push('Allow: /');
  lines.push('');
  lines.push(`# Preview and local builds use page-level ${context.robotsContent} directives.`);
  lines.push(`# User-triggered fetchers such as Perplexity-User may not honor robots.txt consistently.`);
  lines.push(`Sitemap: ${sitemapUrlBuilder('/sitemap.xml', context)}`);

  return `${lines.join('\n')}\n`;
}

function buildSitemap(records, context) {
  const urls = [
    sitemapUrlBuilder('/', context),
    ...records.map((record) => record.absoluteUrl),
  ].sort((left, right) => left.localeCompare(right));

  const body = urls
    .map((url) => `  <url>\n    <loc>${escapeHtml(url)}</loc>\n  </url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function buildVerificationReport({ context, manifestRedirects, recordErrors, records }) {
  return {
    mode: context.mode,
    origin: context.origin,
    basePath: context.basePath,
    pageCount: records.length + 1,
    redirectCount: manifestRedirects.length,
    recordWarnings: recordErrors,
    blockedBots: BLOCKED_BOTS,
    allowedBots: ALLOWED_BOTS,
  };
}

function buildStaticRedirects(context) {
  const modelBase = canonicalPathSerializer('/models/', context.basePath);
  const modelMatcher = modelBase.replace(/\/$/, '');

  return [
    {
      source: `${modelMatcher}/:slug/index.html`,
      destination: `${modelBase}:slug/`,
      permanent: true,
    },
    {
      source: `${modelMatcher}/:slug`,
      destination: `${modelBase}:slug/`,
      permanent: true,
    },
  ];
}

async function removeGeneratedArtifacts() {
  await rm(GENERATED_MODELS_DIR, { force: true, recursive: true });
  await mkdir(GENERATED_MODELS_DIR, { recursive: true });
  await mkdir(GENERATED_PUBLIC_DIR, { recursive: true });
  await mkdir(GENERATED_STATE_DIR, { recursive: true });
}

function enrichRecords(records, context) {
  return records.map((record) => {
    const canonicalPath = canonicalPathSerializer(record.canonicalPath, context.basePath);
    const absoluteUrl = sitemapUrlBuilder(record.canonicalPath, context);

    return {
      ...record,
      canonicalPath,
      absoluteUrl,
      sourceLabel: providerLabel(record.source),
      sourceShort: record.source === 'nim' ? 'NIM' : record.source === 'openrouter' ? 'OR' : record.source,
      tierClass:
        {
          'S+': 'tier-sp',
          S: 'tier-s',
          'A+': 'tier-ap',
          A: 'tier-a',
          'A-': 'tier-am',
          'B+': 'tier-bp',
          B: 'tier-b',
          C: 'tier-c',
        }[record.tier] || 'tier-c',
      sweDisplay: formatValue(record.swe_bench, '—'),
      intelDisplay: formatValue(record.aa_intelligence, '—'),
      speedDisplay:
        record.aa_speed_tps === null || record.aa_speed_tps === undefined
          ? '—'
          : Number(record.aa_speed_tps).toFixed(0),
      description: `${record.name} is available on ${providerLabel(record.source)} with a ${formatValue(record.tier, 'Unranked')} tier, ${formatValue(record.context, 'unknown')} context, ${formatValue(record.swe_bench, 'no')} SWE score, and ${formatValue(record.aa_speed_tps, 'no')} TPS signal on free-router.`,
    };
  });
}

async function writeModelPages(records, context, homeUrl) {
  for (const record of records) {
    const modelDir = path.join(GENERATED_MODELS_DIR, record.slug);
    await mkdir(modelDir, { recursive: true });
    await writeFile(
      path.join(modelDir, 'index.html'),
      buildModelPage(record, context, homeUrl),
      'utf8',
    );
  }
}

async function writeHomepage(template, records, context, redirectCount) {
  const homeUrl = sitemapUrlBuilder('/', context);
  const headMarkup = buildHeadMarkup({
    canonicalUrl: homeUrl,
    description: HOME_DESCRIPTION,
    jsonLd: buildHomeJsonLd(records, homeUrl),
    robotsContent: context.robotsContent,
    title: HOME_TITLE,
    type: 'website',
  });

  const html = template
    .replace('__HEAD_META__', headMarkup)
    .replace('__TAGLINE__', '&gt; Free model router for AI agents')
    .replace('__SUBTITLE__', '&gt; Route through the fastest free models. Start building in seconds.')
    .replaceAll('__MODEL_COUNT__', String(records.length))
    .replace('__MODEL_ROWS__', records.map(buildModelRow).join('\n'))
    .replace('__MODEL_REDIRECT_COUNT__', String(redirectCount));

  await writeFile(GENERATED_INDEX_PATH, html, 'utf8');
}

export async function generateSite({ env = process.env, writeManifest = false } = {}) {
  await removeGeneratedArtifacts();

  const context = resolveBuildContext(env);
  const contextErrors = validateBuildContext(context);
  if (contextErrors.length > 0) {
    throw new Error(contextErrors.join('\n'));
  }

  const [template, data, previousManifest] = await Promise.all([
    readFile(INDEX_TEMPLATE_PATH, 'utf8'),
    readJsonFile(DATA_PATH, 'model rankings'),
    readJsonFile(MANIFEST_PATH, 'slug manifest').catch(() => ({ version: 1, models: [] })),
  ]);

  const resolution = resolveCanonicalRecords(data.models);

  if (resolution.datasetErrors.length > 0) {
    const summary = resolution.datasetErrors
      .map((error) => `${error.code}: ${error.details}`)
      .join('\n');
    throw new Error(`Dataset-fatal site generation errors:\n${summary}`);
  }

  const records = enrichRecords(resolution.records, context);
  const nextManifest = createSlugManifest(
    records.map((record) => ({
      key: record.key,
      source: record.source,
      modelId: record.model_id,
      slug: record.slug,
      canonicalPath: record.canonicalPath,
      name: record.name,
    })),
  );

  const manifestRedirects = diffManifestRedirects(previousManifest, nextManifest);

  const homeUrl = sitemapUrlBuilder('/', context);
  await writeHomepage(template, records, context, manifestRedirects.length);
  await writeModelPages(records, context, homeUrl);
  await writeFile(path.join(GENERATED_PUBLIC_DIR, 'robots.txt'), buildRobotsTxt(context), 'utf8');
  await writeFile(path.join(GENERATED_PUBLIC_DIR, 'sitemap.xml'), buildSitemap(records, context), 'utf8');
  await writeFile(
    path.join(GENERATED_STATE_DIR, 'slug-manifest.generated.json'),
    `${JSON.stringify(nextManifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(GENERATED_STATE_DIR, 'site-report.json'),
    `${JSON.stringify(
      buildVerificationReport({
        context,
        manifestRedirects,
        recordErrors: resolution.recordErrors,
        records,
      }),
      null,
      2,
    )}\n`,
    'utf8',
  );

  if (writeManifest) {
    await writeFile(MANIFEST_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
  }

  return {
    context,
    manifestRedirects,
    nextManifest,
    records,
    staticRedirects: buildStaticRedirects(context),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const writeManifest = process.argv.includes('--write-manifest');

  generateSite({ writeManifest })
    .then(() => {
      process.stdout.write('Generated crawlable site sources.\n');
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
