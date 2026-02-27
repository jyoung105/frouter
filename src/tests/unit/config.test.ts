import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { importFresh } from "../helpers/import-fresh.js";
import { ROOT_DIR } from "../helpers/test-paths.js";
import { cleanupTempHome, makeTempHome } from "../helpers/temp-home.js";

const CONFIG_MODULE_PATH = join(ROOT_DIR, "lib", "config.js");

async function withTempConfigModule(fn) {
  const home = makeTempHome();
  const prevHome = process.env.HOME;
  const prevNv = process.env.NVIDIA_API_KEY;
  const prevOr = process.env.OPENROUTER_API_KEY;

  process.env.HOME = home;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  try {
    const mod = await importFresh(CONFIG_MODULE_PATH);
    await fn({ home, ...mod });
  } finally {
    if (prevHome == null) delete process.env.HOME;
    else process.env.HOME = prevHome;

    if (prevNv == null) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = prevNv;

    if (prevOr == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevOr;

    cleanupTempHome(home);
  }
}

test("saveConfig writes ~/.frouter.json with 0600 permissions", async () => {
  await withTempConfigModule(async ({ saveConfig, CONFIG_PATH }) => {
    saveConfig({
      apiKeys: { nvidia: "nvapi-demo" },
      providers: { nvidia: { enabled: true }, openrouter: { enabled: false } },
    });

    const mode = statSync(CONFIG_PATH).mode & 0o777;
    assert.equal(mode, 0o600);

    const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    assert.equal(saved.apiKeys.nvidia, "nvapi-demo");
    assert.equal(saved.providers.openrouter.enabled, false);
  });
});

test("getApiKey prefers env var over config file", async () => {
  await withTempConfigModule(async ({ getApiKey }) => {
    process.env.NVIDIA_API_KEY = "env-wins";
    const key = getApiKey({ apiKeys: { nvidia: "file-key" } }, "nvidia");
    assert.equal(key, "env-wins");
  });
});

test("loadConfig falls back to defaults for malformed JSON", async () => {
  await withTempConfigModule(async ({ loadConfig, CONFIG_PATH }) => {
    writeFileSync(CONFIG_PATH, "{ broken json", "utf8");
    const cfg = loadConfig();

    assert.deepEqual(cfg.apiKeys, {});
    assert.equal(cfg.providers.nvidia.enabled, true);
    assert.equal(cfg.providers.openrouter.enabled, true);
  });
});

test("loadConfig preserves malformed config via a timestamped backup", async () => {
  await withTempConfigModule(async ({ loadConfig, CONFIG_PATH, home }) => {
    writeFileSync(CONFIG_PATH, "{ broken json", "utf8");
    loadConfig();

    const backups = readdirSync(home).filter((name) =>
      name.startsWith(".frouter.json.corrupt-"),
    );
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(home, backups[0]), "utf8"), "{ broken json");
  });
});

test("loadConfig returns defaults when config file does not exist", async () => {
  await withTempConfigModule(async ({ loadConfig }) => {
    const cfg = loadConfig();
    assert.deepEqual(cfg.apiKeys, {});
    assert.equal(cfg.providers.nvidia.enabled, true);
    assert.equal(cfg.providers.openrouter.enabled, true);
    assert.equal(cfg.ui.scrollSortPauseMs, 1500);
  });
});

test("loadConfig preserves ui.scrollSortPauseMs when provided", async () => {
  await withTempConfigModule(async ({ loadConfig, CONFIG_PATH }) => {
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify(
        {
          apiKeys: { nvidia: "nvapi-demo" },
          providers: {
            nvidia: { enabled: true },
            openrouter: { enabled: false },
          },
          ui: { scrollSortPauseMs: 2600 },
        },
        null,
        2,
      ),
      "utf8",
    );

    const cfg = loadConfig();
    assert.equal(cfg.ui.scrollSortPauseMs, 2600);
  });
});

test("getApiKey returns null for unknown provider", async () => {
  await withTempConfigModule(async ({ getApiKey }) => {
    assert.equal(getApiKey({ apiKeys: {} }, "unknown-provider"), null);
  });
});

test("validateProviderApiKey rejects incorrect prefix and trims valid input", async () => {
  await withTempConfigModule(async ({ validateProviderApiKey }) => {
    const bad = validateProviderApiKey("nvidia", "sk-or-wrong-prefix");
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /Expected prefix "nvapi-"/);

    const good = validateProviderApiKey("openrouter", "  sk-or-valid-key  ");
    assert.equal(good.ok, true);
    assert.equal(good.key, "sk-or-valid-key");
  });
});
