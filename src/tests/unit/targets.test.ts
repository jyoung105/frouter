import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { importFresh } from "../helpers/import-fresh.js";
import { ROOT_DIR } from "../helpers/test-paths.js";
import { cleanupTempHome, makeTempHome } from "../helpers/temp-home.js";

const TARGETS_MODULE_PATH = join(ROOT_DIR, "lib", "targets.js");

async function withTempTargetsModule(fn) {
  const home = makeTempHome();
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const mod = await importFresh(TARGETS_MODULE_PATH);
    await fn({ home, ...mod });
  } finally {
    if (prevHome == null) delete process.env.HOME;
    else process.env.HOME = prevHome;
    cleanupTempHome(home);
  }
}

test("writeOpenCode merges provider block, sets model, and writes backup", async () => {
  await withTempTargetsModule(async ({ writeOpenCode, home }) => {
    const configPath = join(home, ".config", "opencode", "opencode.json");
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          plugin: { keepMe: true },
          provider: { existing: { name: "legacy" } },
        },
        null,
        2,
      ),
    );

    const outPath = writeOpenCode(
      { id: "meta/llama-3.1-8b-instruct" },
      "nvidia",
    );
    assert.equal(outPath, configPath);

    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(cfg.plugin.keepMe, true);
    assert.equal(cfg.provider.existing.name, "legacy");
    assert.equal(cfg.provider.nvidia.options.apiKey, "{env:NVIDIA_API_KEY}");
    assert.equal(cfg.model, "nvidia/meta/llama-3.1-8b-instruct");

    const backups = readdirSync(dirname(configPath)).filter((f) =>
      f.startsWith("opencode.json.backup-"),
    );
    assert.equal(backups.length, 1);
  });
});

test("writeOpenCode defaults to env placeholder even when caller passes key", async () => {
  await withTempTargetsModule(async ({ writeOpenCode, home }) => {
    const configPath = join(home, ".config", "opencode", "opencode.json");
    writeOpenCode(
      { id: "mistralai/mistral-small-3.2-24b-instruct:free" },
      "openrouter",
      "sk-or-demo",
    );

    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(
      cfg.provider.openrouter.options.apiKey,
      "{env:OPENROUTER_API_KEY}",
    );
    assert.equal(
      cfg.model,
      "openrouter/mistralai/mistral-small-3.2-24b-instruct:free",
    );
  });
});

test("writeOpenCode can persist provided API key only with explicit opt-in", async () => {
  await withTempTargetsModule(async ({ writeOpenCode, home }) => {
    const configPath = join(home, ".config", "opencode", "opencode.json");
    writeOpenCode(
      { id: "mistralai/mistral-small-3.2-24b-instruct:free" },
      "openrouter",
      "sk-or-demo",
      { persistApiKey: true },
    );

    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(cfg.provider.openrouter.options.apiKey, "sk-or-demo");
  });
});

test("writeOpenCode skips backup/write when resulting config is unchanged", async () => {
  await withTempTargetsModule(async ({ writeOpenCode, home }) => {
    const configPath = join(home, ".config", "opencode", "opencode.json");
    const dir = dirname(configPath);

    writeOpenCode({ id: "meta/llama-3.1-8b-instruct" }, "nvidia");
    const backupsBefore = readdirSync(dir).filter((f) =>
      f.startsWith("opencode.json.backup-"),
    );
    assert.equal(backupsBefore.length, 0);

    writeOpenCode({ id: "meta/llama-3.1-8b-instruct" }, "nvidia");
    const backupsAfter = readdirSync(dir).filter((f) =>
      f.startsWith("opencode.json.backup-"),
    );
    assert.equal(backupsAfter.length, 0);
  });
});

test("resolveOpenCodeSelection always respects user chosen provider (NIM with oh-my-opencode)", async () => {
  await withTempTargetsModule(async ({ resolveOpenCodeSelection, home }) => {
    const configPath = join(home, ".config", "opencode", "opencode.json");
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          plugin: ["oh-my-opencode"],
        },
        null,
        2,
      ),
    );

    const selected = {
      id: "qwen/qwen2.5-coder-32b-instruct",
      providerKey: "nvidia",
    };
    const allModels = [
      selected,
      { id: "qwen/qwen2.5-coder-32b-instruct:free", providerKey: "openrouter" },
    ];

    const resolved = resolveOpenCodeSelection(selected, "nvidia", allModels);
    assert.equal(resolved.fallback, false);
    assert.equal(resolved.providerKey, "nvidia");
    assert.equal(resolved.model.id, "qwen/qwen2.5-coder-32b-instruct");
  });
});

test("resolveOpenCodeSelection keeps original model without oh-my-opencode plugin", async () => {
  await withTempTargetsModule(async ({ resolveOpenCodeSelection }) => {
    const selected = {
      id: "qwen/qwen2.5-coder-32b-instruct",
      providerKey: "nvidia",
    };
    const allModels = [
      selected,
      { id: "qwen/qwen2.5-coder-32b-instruct:free", providerKey: "openrouter" },
    ];

    const resolved = resolveOpenCodeSelection(selected, "nvidia", allModels);
    assert.equal(resolved.fallback, false);
    assert.equal(resolved.providerKey, "nvidia");
    assert.equal(resolved.model.id, "qwen/qwen2.5-coder-32b-instruct");
  });
});

test("resolveOpenCodeSelection remaps NIM Stepfun model to OpenRouter for OpenCode compatibility", async () => {
  await withTempTargetsModule(async ({ resolveOpenCodeSelection, home }) => {
    const configPath = join(home, ".config", "opencode", "opencode.json");
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2),
    );

    const selected = {
      id: "stepfun-ai/step-3.5-flash",
      providerKey: "nvidia",
    };
    const allModels = [
      selected,
      { id: "stepfun/step-3.5-flash:free", providerKey: "openrouter" },
    ];

    const resolved = resolveOpenCodeSelection(selected, "nvidia", allModels);
    assert.equal(resolved.fallback, true);
    assert.equal(resolved.providerKey, "openrouter");
    assert.equal(resolved.model.id, "stepfun/step-3.5-flash:free");
  });
});

test("resolveOpenCodeSelection preserves OpenRouter selection as-is", async () => {
  await withTempTargetsModule(async ({ resolveOpenCodeSelection, home }) => {
    const configPath = join(home, ".config", "opencode", "opencode.json");
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ plugin: { "oh-my-opencode": {} } }, null, 2),
    );

    const selected = {
      id: "meta-llama/llama-3.2-3b-instruct:free",
      providerKey: "openrouter",
    };

    const resolved = resolveOpenCodeSelection(selected, "openrouter", [
      selected,
    ]);
    assert.equal(resolved.fallback, false);
    assert.equal(resolved.providerKey, "openrouter");
    assert.equal(resolved.model.id, "meta-llama/llama-3.2-3b-instruct:free");
  });
});

test("resolveOpenCodeSelection still remaps when fallback model is unavailable in loaded catalog", async () => {
  await withTempTargetsModule(async ({ resolveOpenCodeSelection }) => {
    const selected = {
      id: "stepfun-ai/step-3.5-flash",
      providerKey: "nvidia",
    };
    const allModels = [selected];

    const resolved = resolveOpenCodeSelection(selected, "nvidia", allModels);
    assert.equal(resolved.fallback, true);
    assert.equal(resolved.providerKey, "openrouter");
    assert.equal(resolved.model.id, "stepfun/step-3.5-flash:free");
  });
});

test("writeOpenClaw writes provider/default model fields and keeps env key out by default", async () => {
  await withTempTargetsModule(async ({ writeOpenClaw, home }) => {
    const configPath = join(home, ".openclaw", "openclaw.json");
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: { defaults: { models: { "legacy/model": {} } } },
        },
        null,
        2,
      ),
    );

    writeOpenClaw(
      { id: "mistralai/mistral-small-3.2-24b-instruct:free" },
      "openrouter",
      "sk-or-demo",
    );

    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    const qid = "openrouter/mistralai/mistral-small-3.2-24b-instruct:free";

    assert.equal(cfg.models.providers.openrouter.api, "openai-completions");
    assert.equal(cfg.env?.OPENROUTER_API_KEY, undefined);
    assert.equal(cfg.agents.defaults.model.primary, qid);
    assert.deepEqual(cfg.agents.defaults.models[qid], {});
    assert.deepEqual(cfg.agents.defaults.models["legacy/model"], {});
  });
});

test("writeOpenClaw can persist env key only with explicit opt-in", async () => {
  await withTempTargetsModule(async ({ writeOpenClaw, home }) => {
    const configPath = join(home, ".openclaw", "openclaw.json");
    writeOpenClaw(
      { id: "mistralai/mistral-small-3.2-24b-instruct:free" },
      "openrouter",
      "sk-or-demo",
      { persistApiKey: true },
    );

    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(cfg.env.OPENROUTER_API_KEY, "sk-or-demo");
  });
});

test("writeOpenClaw does not create env key when API key is missing", async () => {
  await withTempTargetsModule(async ({ writeOpenClaw, home }) => {
    const configPath = join(home, ".openclaw", "openclaw.json");
    writeOpenClaw({ id: "meta/llama-3.1-8b-instruct" }, "nvidia", null);

    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(cfg.env?.NVIDIA_API_KEY, undefined);
  });
});

test("writeOpenCode rejects models explicitly marked unsupported by OpenCode", async () => {
  await withTempTargetsModule(async ({ writeOpenCode }) => {
    assert.throws(
      () =>
        writeOpenCode(
          { id: "some/provider-model", opencodeSupported: false },
          "nvidia",
        ),
      /not marked as OpenCode-supported/i,
    );
  });
});

test("writeOpenCode throws for unknown provider key (error scenario)", async () => {
  await withTempTargetsModule(async ({ writeOpenCode }) => {
    assert.throws(
      () => writeOpenCode({ id: "demo/model" }, "unknown"),
      /Unknown provider "unknown"/,
    );
  });
});

test("writeOpenClaw throws for unknown provider key (error scenario)", async () => {
  await withTempTargetsModule(async ({ writeOpenClaw }) => {
    assert.throws(
      () => writeOpenClaw({ id: "demo/model" }, "unknown", "k"),
      /Unknown provider "unknown"/,
    );
  });
});

test("persistApiKey opt-in rejects invalid provider key format", async () => {
  await withTempTargetsModule(async ({ writeOpenCode }) => {
    assert.throws(
      () =>
        writeOpenCode({ id: "demo/model" }, "nvidia", "sk-or-not-nvidia", {
          persistApiKey: true,
        }),
      /Refusing to persist invalid nvidia API key/,
    );
  });
});
