import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { importFresh } from "../helpers/import-fresh.js";
import { ROOT_DIR } from "../helpers/test-paths.js";
import { cleanupTempHome, makeTempHome } from "../helpers/temp-home.js";
import { runNode } from "../helpers/spawn-cli.js";

const CONFIG_MODULE_PATH = join(ROOT_DIR, "lib", "config.js");

async function withTempConfigModule(fn) {
  const home = makeTempHome();
  const prevHome = process.env.HOME;
  const prevNv = process.env.NVIDIA_API_KEY;

  process.env.HOME = home;
  delete process.env.NVIDIA_API_KEY;

  try {
    const mod = await importFresh(CONFIG_MODULE_PATH);
    await fn({ home, ...mod });
  } finally {
    if (prevHome == null) delete process.env.HOME;
    else process.env.HOME = prevHome;

    if (prevNv == null) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = prevNv;

    cleanupTempHome(home);
  }
}

test("security: env key has precedence over file key", async () => {
  await withTempConfigModule(async ({ getApiKey }) => {
    process.env.NVIDIA_API_KEY = "env-priority";
    const key = getApiKey({ apiKeys: { nvidia: "file-fallback" } }, "nvidia");
    assert.equal(key, "env-priority");
  });
});

test("security: promptMasked does not echo plaintext key to stdout", async () => {
  const secret = "supersecret";
  const configUrl = pathToFileURL(CONFIG_MODULE_PATH).href;

  const script = `
import { promptMasked } from ${JSON.stringify(configUrl)};

if (typeof process.stdin.setRawMode !== 'function') process.stdin.setRawMode = () => {};
try {
  Object.defineProperty(process.stdin, 'isRaw', { value: false, writable: true, configurable: true });
} catch {}

const value = await promptMasked('key: ');
console.log('\\nLEN=' + value.length);
`;

  const sequence = [...`${secret}\r`];
  let delayMs = 100;
  const inputChunks = sequence.map((ch) => {
    const chunk = { delayMs, data: ch };
    delayMs += 40;
    return chunk;
  });

  const result = await runNode(["--input-type=module", "-e", script], {
    cwd: ROOT_DIR,
    inputChunks,
    timeoutMs: 8_000,
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /•{3,}/u); // masked bullets are shown
  assert.doesNotMatch(result.stdout, /supersecret/); // plaintext should not be echoed
  assert.match(result.stdout, /LEN=11/);
});
