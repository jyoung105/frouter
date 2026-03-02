import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHttpServer } from "../helpers/mock-http.js";
import { BIN_PATH, ROOT_DIR } from "../helpers/test-paths.js";
import {
  cleanupTempHome,
  defaultConfig,
  makeTempHome,
  writeHomeConfig,
} from "../helpers/temp-home.js";
import { runNode } from "../helpers/spawn-cli.js";
import { runInPty } from "../helpers/run-pty.js";

const PKG_VERSION = JSON.parse(
  readFileSync(join(ROOT_DIR, "..", "package.json"), "utf8"),
).version;

function makeConfig(home: string) {
  writeHomeConfig(home, defaultConfig({ apiKeys: { nvidia: "nvapi-test" } }));
}

test("update check: skips silently when version matches", async () => {
  const server = await createHttpServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: PKG_VERSION }));
  });

  const home = makeTempHome();
  try {
    makeConfig(home);
    const result = await runNode([BIN_PATH], {
      cwd: ROOT_DIR,
      env: {
        HOME: home,
        FROUTER_REGISTRY_URL: `${server.baseUrl}/frouter-cli/latest`,
      },
      timeoutMs: 7_000,
    });

    assert.doesNotMatch(result.stdout + result.stderr, /Update available/);
  } finally {
    cleanupTempHome(home);
    await server.close();
  }
});

test("update check: skips silently when registry version is older", async () => {
  const server = await createHttpServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: "0.0.1" }));
  });

  const home = makeTempHome();
  try {
    makeConfig(home);
    const result = await runNode([BIN_PATH], {
      cwd: ROOT_DIR,
      env: {
        HOME: home,
        FROUTER_REGISTRY_URL: `${server.baseUrl}/frouter-cli/latest`,
      },
      timeoutMs: 7_000,
    });

    assert.doesNotMatch(result.stdout + result.stderr, /Update available/);
  } finally {
    cleanupTempHome(home);
    await server.close();
  }
});

test("update check: shows update available in non-TTY and auto-skips", async () => {
  const server = await createHttpServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: "99.0.0" }));
  });

  const home = makeTempHome();
  try {
    makeConfig(home);
    const result = await runNode([BIN_PATH], {
      cwd: ROOT_DIR,
      env: {
        HOME: home,
        FROUTER_REGISTRY_URL: `${server.baseUrl}/frouter-cli/latest`,
      },
      timeoutMs: 7_000,
    });

    const combined = result.stdout + result.stderr;
    // Should show update available message
    assert.match(combined, /Update available/);
    assert.match(combined, /99\.0\.0/);
    // In non-TTY, promptYesNo auto-returns false → falls through to TTY check
    assert.match(combined, /requires an interactive terminal/i);
  } finally {
    cleanupTempHome(home);
    await server.close();
  }
});

const SKIP_PTY = process.platform === "win32";

test(
  'update check: interactive TTY prompt declines update on "n"',
  { skip: SKIP_PTY && "PTY harness not available on Windows" },
  async () => {
    const server = await createHttpServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "99.0.0" }));
    });

    const home = makeTempHome();
    try {
      makeConfig(home);
      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          FROUTER_REGISTRY_URL: `${server.baseUrl}/frouter-cli/latest`,
        },
        // Send 'n' to decline update, then 'q' to quit TUI
        inputChunks: [
          { delayMs: 2000, data: "n" },
          { delayMs: 4000, data: "q" },
        ],
        timeoutMs: 15_000,
      });

      assert.match(result.stdout, /Update available/);
      assert.match(result.stdout, /99\.0\.0/);
      assert.equal(result.timedOut, false);
    } finally {
      cleanupTempHome(home);
      await server.close();
    }
  },
);

test(
  'update check: interactive TTY accepts "y" even when Enter arrives in same input chunk',
  { skip: SKIP_PTY && "PTY harness not available on Windows" },
  async () => {
    const server = await createHttpServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "99.0.0" }));
    });

    const home = makeTempHome();
    try {
      makeConfig(home);
      const fakeBin = join(home, "fake-bin");
      const marker = join(home, "update-invoked.log");
      const npmBin = join(fakeBin, "npm");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(
        npmBin,
        `#!/bin/sh
echo "$@" > "$HOME/update-invoked.log"
exit 0
`,
      );
      chmodSync(npmBin, 0o755);

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          PATH: `${fakeBin}:${process.env.PATH || ""}`,
          FROUTER_REGISTRY_URL: `${server.baseUrl}/frouter-cli/latest`,
          npm_config_user_agent: "",
          npm_execpath: "",
        },
        // Send y+Enter together to simulate terminals that coalesce chars.
        // Then send q to exit the TUI after update completes.
        inputChunks: [
          { delayMs: 2000, data: "y\r" },
          { delayMs: 6000, data: "q" },
        ],
        timeoutMs: 20_000,
      });

      assert.equal(result.timedOut, false);
      assert.match(result.stdout, /Update available/);
      assert.match(result.stdout, /Update now\? \(Y\/n, default: n\):/);
      assert.match(result.stdout, /Updating frouter-cli/);
      assert.match(result.stdout, /\d{1,3}%/);
      assert.match(result.stdout, /Updated to 99\.0\.0/);
      assert.match(result.stdout, /Restarting frouter now/);
      assert.equal((result.stdout.match(/Update available/g) || []).length, 1);
      assert.equal(
        readFileSync(marker, "utf8").trim(),
        "install -g frouter-cli",
      );
    } finally {
      cleanupTempHome(home);
      await server.close();
    }
  },
);

test("update check: silently continues when registry is unreachable", async () => {
  const home = makeTempHome();
  try {
    makeConfig(home);
    const result = await runNode([BIN_PATH], {
      cwd: ROOT_DIR,
      env: {
        HOME: home,
        FROUTER_REGISTRY_URL: "http://127.0.0.1:1/frouter-cli/latest",
      },
      timeoutMs: 7_000,
    });

    assert.doesNotMatch(result.stdout + result.stderr, /Update available/);
    assert.match(result.stderr, /requires an interactive terminal/i);
  } finally {
    cleanupTempHome(home);
  }
});

test("update check: silently continues when registry returns invalid JSON", async () => {
  const server = await createHttpServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("not json at all");
  });

  const home = makeTempHome();
  try {
    makeConfig(home);
    const result = await runNode([BIN_PATH], {
      cwd: ROOT_DIR,
      env: {
        HOME: home,
        FROUTER_REGISTRY_URL: `${server.baseUrl}/frouter-cli/latest`,
      },
      timeoutMs: 7_000,
    });

    assert.doesNotMatch(result.stdout + result.stderr, /Update available/);
    assert.match(result.stderr, /requires an interactive terminal/i);
  } finally {
    cleanupTempHome(home);
    await server.close();
  }
});

test(
  "update check: npm_config_* env vars are stripped from update child process",
  { skip: SKIP_PTY && "PTY harness not available on Windows" },
  async () => {
    const server = await createHttpServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "99.0.0" }));
    });

    const home = makeTempHome();
    try {
      makeConfig(home);
      const fakeBin = join(home, "fake-bin");
      const envDump = join(home, "child-env.log");
      const npmBin = join(fakeBin, "npm");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(
        npmBin,
        `#!/bin/sh
env > "$HOME/child-env.log"
exit 0
`,
      );
      chmodSync(npmBin, 0o755);

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          PATH: `${fakeBin}:${process.env.PATH || ""}`,
          FROUTER_REGISTRY_URL: `${server.baseUrl}/frouter-cli/latest`,
          npm_config_prefix: "/tmp/bogus-prefix",
          npm_config_global_prefix: "/tmp/bogus-global",
          npm_config_user_agent: "npm/10.0.0 node/v20.0.0",
          npm_execpath: "/usr/lib/node_modules/npm/bin/npm-cli.js",
          npm_lifecycle_event: "postinstall",
          FROUTER_KEEP_THIS: "yes",
        },
        inputChunks: [
          { delayMs: 2000, data: "y\r" },
          { delayMs: 6000, data: "q" },
        ],
        timeoutMs: 20_000,
      });

      assert.equal(result.timedOut, false);
      assert.match(result.stdout, /Updated to 99\.0\.0/);

      const childEnv = readFileSync(envDump, "utf8");
      // npm_config_* vars must NOT appear in the child process
      assert.doesNotMatch(childEnv, /npm_config_prefix/i);
      assert.doesNotMatch(childEnv, /npm_config_global_prefix/i);
      assert.doesNotMatch(childEnv, /npm_config_user_agent/i);
      assert.doesNotMatch(childEnv, /npm_execpath/i);
      assert.doesNotMatch(childEnv, /npm_lifecycle_event/i);
      // Non-npm vars must still be present
      assert.match(childEnv, /FROUTER_KEEP_THIS=yes/);
    } finally {
      cleanupTempHome(home);
      await server.close();
    }
  },
);

test(
  "update check: update failure shows error message with clean env",
  { skip: SKIP_PTY && "PTY harness not available on Windows" },
  async () => {
    const server = await createHttpServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "99.0.0" }));
    });

    const home = makeTempHome();
    try {
      makeConfig(home);
      const fakeBin = join(home, "fake-bin");
      const npmBin = join(fakeBin, "npm");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(
        npmBin,
        `#!/bin/sh
case "$1" in
  --version) echo "10.0.0"; exit 0 ;;
  *) exit 1 ;;
esac
`,
      );
      chmodSync(npmBin, 0o755);

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          PATH: `${fakeBin}:${process.env.PATH || ""}`,
          FROUTER_REGISTRY_URL: `${server.baseUrl}/frouter-cli/latest`,
          npm_config_user_agent: "",
          npm_execpath: "",
        },
        inputChunks: [
          { delayMs: 2000, data: "y\r" },
          { delayMs: 6000, data: "q" },
        ],
        timeoutMs: 20_000,
      });

      assert.equal(result.timedOut, false);
      assert.match(result.stdout, /Update failed/);
      assert.doesNotMatch(result.stdout, /Updated to/);
    } finally {
      cleanupTempHome(home);
      await server.close();
    }
  },
);

test(
  "update check: FROUTER_SKIP_UPDATE_ONCE suppresses update check entirely",
  async () => {
    const server = await createHttpServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "99.0.0" }));
    });

    const home = makeTempHome();
    try {
      makeConfig(home);
      const result = await runNode([BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          FROUTER_REGISTRY_URL: `${server.baseUrl}/frouter-cli/latest`,
          FROUTER_SKIP_UPDATE_ONCE: "1",
        },
        timeoutMs: 7_000,
      });

      assert.doesNotMatch(result.stdout + result.stderr, /Update available/);
    } finally {
      cleanupTempHome(home);
      await server.close();
    }
  },
);

test(
  "update check: simulated 1.1.11 publish updates global binary and restart sees new version",
  { skip: SKIP_PTY && "PTY harness not available on Windows" },
  async () => {
    const server = await createHttpServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "1.1.11" }));
    });

    // Save original package.json to restore later
    const pkgPath = join(ROOT_DIR, "..", "package.json");
    const originalPkg = readFileSync(pkgPath, "utf8");

    const home = makeTempHome();
    try {
      makeConfig(home);
      const fakeBin = join(home, "fake-bin");
      const marker = join(home, "update-invoked.log");
      const npmBin = join(fakeBin, "npm");
      mkdirSync(fakeBin, { recursive: true });

      // Fake npm: on --version succeed, on install -g simulate updating
      // the package.json version (like a real npm install -g would replace the package)
      writeFileSync(
        npmBin,
        `#!/bin/sh
case "$1" in
  --version) echo "10.0.0"; exit 0 ;;
  install)
    echo "$@" > "$HOME/update-invoked.log"
    # Simulate global install by updating package.json version to 1.1.11
    PKG="\${FROUTER_PKG_PATH}"
    if [ -n "\$PKG" ]; then
      sed 's/"version": *"[^"]*"/"version": "1.1.11"/' "\$PKG" > "\$PKG.tmp" && mv "\$PKG.tmp" "\$PKG"
    fi
    exit 0
    ;;
  *) exit 1 ;;
esac
`,
      );
      chmodSync(npmBin, 0o755);

      const result = await runInPty(process.execPath, [BIN_PATH], {
        cwd: ROOT_DIR,
        env: {
          HOME: home,
          PATH: `${fakeBin}:${process.env.PATH || ""}`,
          FROUTER_REGISTRY_URL: `${server.baseUrl}/frouter-cli/latest`,
          FROUTER_PKG_PATH: pkgPath,
          npm_config_user_agent: "",
          npm_execpath: "",
        },
        inputChunks: [
          { delayMs: 2000, data: "y\r" },
          { delayMs: 6000, data: "q" },
        ],
        timeoutMs: 20_000,
      });

      assert.equal(result.timedOut, false);

      // Verify update flow
      assert.match(result.stdout, /Update available/);
      assert.match(result.stdout, /1\.1\.11/);
      assert.match(result.stdout, /Updated to 1\.1\.11/);
      assert.match(result.stdout, /Restarting frouter now/);

      // Verify fake npm received correct install command
      assert.equal(
        readFileSync(marker, "utf8").trim(),
        "install -g frouter-cli",
      );

      // Verify "Update available" appeared only once (restarted process didn't show it)
      assert.equal((result.stdout.match(/Update available/g) || []).length, 1);

      // Verify package.json was updated to 1.1.11 (simulating global binary update)
      const updatedPkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      assert.equal(updatedPkg.version, "1.1.11");
    } finally {
      // Restore original package.json
      writeFileSync(pkgPath, originalPkg);
      cleanupTempHome(home);
      await server.close();
    }
  },
);

test("update check: --best mode does not prompt for updates", async () => {
  const server = await createHttpServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: "99.0.0" }));
  });

  const home = makeTempHome();
  try {
    makeConfig(home);
    const result = await runNode([BIN_PATH, "--best"], {
      cwd: ROOT_DIR,
      env: {
        HOME: home,
        FROUTER_REGISTRY_URL: `${server.baseUrl}/frouter-cli/latest`,
      },
      timeoutMs: 15_000,
    });

    assert.doesNotMatch(result.stdout + result.stderr, /Update available/);
  } finally {
    cleanupTempHome(home);
    await server.close();
  }
});
