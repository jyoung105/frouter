import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { generateSite } from './generate-site.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');

function runViteBuild() {
  const result = spawnSync('npx', ['vite', 'build'], {
    cwd: siteRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function verifyArtifacts() {
  const distIndexPath = path.join(siteRoot, 'dist', 'index.html');
  const distSitemapPath = path.join(siteRoot, 'dist', 'sitemap.xml');
  const distRobotsPath = path.join(siteRoot, 'dist', 'robots.txt');

  const [indexHtml, sitemapXml, robotsTxt] = await Promise.all([
    readFile(distIndexPath, 'utf8'),
    readFile(distSitemapPath, 'utf8'),
    readFile(distRobotsPath, 'utf8'),
  ]);

  const requiredIndexFragments = [
    'Free model router for AI coding tools',
    'Compare providers, benchmark latency, start building.',
    'href="models/',
    'model-link',
  ];

  for (const fragment of requiredIndexFragments) {
    if (!indexHtml.includes(fragment)) {
      throw new Error(`Built homepage is missing required crawlable HTML fragment: ${fragment}`);
    }
  }

  for (const fragment of ['Googlebot', 'GPTBot', 'Sitemap:']) {
    if (!robotsTxt.includes(fragment)) {
      throw new Error(`Generated robots.txt is missing ${fragment}`);
    }
  }

  for (const fragment of ['<urlset', '<loc>']) {
    if (!sitemapXml.includes(fragment)) {
      throw new Error(`Generated sitemap.xml is missing ${fragment}`);
    }
  }
}

async function main() {
  await generateSite();
  runViteBuild();
  await verifyArtifacts();
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
