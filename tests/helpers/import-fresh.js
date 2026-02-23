import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function importFresh(absPath) {
  const url = pathToFileURL(absPath);
  url.searchParams.set('t', randomUUID());
  return import(url.href);
}
