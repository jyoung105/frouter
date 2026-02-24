import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELPERS_DIR = dirname(fileURLToPath(import.meta.url));
export const TESTS_DIR = join(HELPERS_DIR, '..');
export const ROOT_DIR = join(TESTS_DIR, '..');
export const BIN_PATH = join(ROOT_DIR, 'bin', 'frouter.js');
export const LIB_DIR = join(ROOT_DIR, 'lib');
