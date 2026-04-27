#!/usr/bin/env node
// Migration shim — frouter has been renamed to free-router.
// This thin wrapper re-execs the free-router binary so existing users
// who run `npm update -g frouter` keep working while they migrate.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

process.stderr.write(
  `\n${YELLOW}  frouter has been renamed to ${BOLD}free-router${RESET}${YELLOW}.\n` +
    `  This shim is forwarding to free-router for backward compatibility.\n` +
    `  Migrate with: ${BOLD}npm install -g free-router${RESET}${YELLOW} ` +
    `(or: ${BOLD}bun install -g free-router${RESET}${YELLOW})${RESET}\n\n`,
);

const require = createRequire(import.meta.url);
let freeRouterBin;
try {
  freeRouterBin = require.resolve("free-router/dist/bin/free-router.js");
} catch (err) {
  process.stderr.write(
    `\x1b[31m  Failed to locate free-router. Reinstall manually: npm install -g free-router${RESET}\n`,
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
