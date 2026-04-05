import fs from 'node:fs';
import path from 'node:path';

import { defineConfig } from 'vite';

function collectHtmlEntries(rootDir: string, directory: string, entries: Record<string, string>) {
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectHtmlEntries(rootDir, resolved, entries);
      continue;
    }

    if (entry.isFile() && entry.name === 'index.html') {
      const relativeName = path.relative(rootDir, resolved).replace(/\\/g, '/');
      entries[relativeName] = resolved;
    }
  }
}

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  build: {
    rollupOptions: {
      input: (() => {
        const rootDir = process.cwd();
        const entries: Record<string, string> = {
          index: path.resolve(rootDir, 'index.html'),
        };

        collectHtmlEntries(rootDir, path.resolve(rootDir, 'models'), entries);
        return entries;
      })(),
    },
  },
});
