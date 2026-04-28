#!/usr/bin/env node
// Migration shim — frouter-cli moved to @bytonylee/free-router.
// This wrapper lets legacy frouter-cli installs expose the canonical
// free-router command while forwarding execution to the canonical package.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const NEW_PACKAGE = "@bytonylee/free-router";

process.stderr.write(
  `\n${YELLOW}  frouter-cli moved to ${BOLD}${NEW_PACKAGE}${RESET}${YELLOW}.\n` +
    `  This shim is forwarding the ${BOLD}free-router${RESET}${YELLOW} command to the canonical package.\n` +
    `  Reinstall with: ${BOLD}npm install -g ${NEW_PACKAGE}${RESET}${YELLOW} ` +
    `(or: ${BOLD}bun install -g ${NEW_PACKAGE}${RESET}${YELLOW})${RESET}\n\n`,
);

const require = createRequire(import.meta.url);
let freeRouterBin;
try {
  freeRouterBin = require.resolve(`${NEW_PACKAGE}/dist/bin/free-router.js`);
} catch (err) {
  process.stderr.write(
    `\x1b[31m  Failed to locate ${NEW_PACKAGE}. Reinstall manually: npm install -g ${NEW_PACKAGE}${RESET}\n`,
  );
  process.stderr.write(`${DIM}  ${err && err.message ? err.message : String(err)}${RESET}\n`);
  process.exit(1);
}

const child = spawn(process.execPath, [freeRouterBin, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  process.stderr.write(`\x1b[31m  free-router failed to start: ${err.message}${RESET}\n`);
  process.exit(1);
});
