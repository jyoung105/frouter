import test from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import { importFresh } from "../helpers/import-fresh.js";
import { ROOT_DIR } from "../helpers/test-paths.js";
import { cleanupTempHome, makeTempHome } from "../helpers/temp-home.js";

const CONFIG_MODULE_PATH = join(ROOT_DIR, "lib", "config.js");
const TARGETS_MODULE_PATH = join(ROOT_DIR, "lib", "targets.js");

test("security: config file is written with mode 0600", async () => {
  const home = makeTempHome();
  const prevHome = process.env.HOME;
  process.env.HOME = home;

  try {
    const { saveConfig, CONFIG_PATH } = await importFresh(CONFIG_MODULE_PATH);
    saveConfig({
      apiKeys: { nvidia: "nvapi-mode-check" },
      providers: { nvidia: { enabled: true }, openrouter: { enabled: true } },
    });

    const mode = statSync(CONFIG_PATH).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    if (prevHome == null) delete process.env.HOME;
    else process.env.HOME = prevHome;
    cleanupTempHome(home);
  }
});

test("security: target config files are written with mode 0600", async () => {
  const home = makeTempHome();
  const prevHome = process.env.HOME;
  process.env.HOME = home;

  try {
    const { writeOpenCode, writeOpenClaw } =
      await importFresh(TARGETS_MODULE_PATH);
    writeOpenCode({ id: "meta/llama-3.1-8b-instruct" }, "nvidia");
    writeOpenClaw({ id: "meta/llama-3.1-8b-instruct" }, "nvidia", "nvapi-test");

    const openCodePath = join(home, ".config", "opencode", "opencode.json");
    const openClawPath = join(home, ".openclaw", "openclaw.json");

    const openCodeMode = statSync(openCodePath).mode & 0o777;
    const openClawMode = statSync(openClawPath).mode & 0o777;

    assert.equal(openCodeMode, 0o600);
    assert.equal(openClawMode, 0o600);
  } finally {
    if (prevHome == null) delete process.env.HOME;
    else process.env.HOME = prevHome;
    cleanupTempHome(home);
  }
});
