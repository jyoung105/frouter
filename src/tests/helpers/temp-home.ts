import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function makeTempHome(prefix = "frouter-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanupTempHome(homePath: string): void {
  rmSync(homePath, { recursive: true, force: true });
}

export function writeHomeConfig(homePath: string, config: any): void {
  writeFileSync(
    join(homePath, ".frouter.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
}

export function defaultConfig(partial: any = {}) {
  return {
    apiKeys: {},
    providers: {
      nvidia: { enabled: true },
      openrouter: { enabled: true },
    },
    ...partial,
  };
}
