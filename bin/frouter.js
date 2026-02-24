#!/usr/bin/env node
// Deprecated compatibility entrypoint.
// Source of truth lives in src/, runtime build output in dist/.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'dist', 'bin', 'frouter.js');

if (!existsSync(built)) {
  process.stderr.write('Missing dist/bin/frouter.js. Run `npm run build` first.\n');
  process.exit(1);
}

await import(pathToFileURL(built).href);
