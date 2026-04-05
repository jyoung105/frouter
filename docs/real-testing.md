# Real testing guide for the published `frouter` package

This guide is for **real/manual verification of the official published package** rather than the local `src/` or `dist/` build.

## Goal

When you want confidence that users can really install and run `frouter`, test the published package in an isolated environment:

- use the **published npm package**
- use an **isolated HOME**
- keep logs and scratch files inside **`.real-testing/`**
- never let the test overwrite your real `~/.frouter.json`

## Rule of thumb

If the purpose is “does the released package work for a real user?”, do **not** run:

- `node dist/bin/frouter.js`
- repo-local patched code
- your normal shell with your real home/config

Instead, run the official package through `npx` or an isolated global install.

## Recommended local workspace

Create a disposable workspace in the repo root:

```bash
export FROUTER_REAL_TEST_DIR="$PWD/.real-testing"
mkdir -p \
  "$FROUTER_REAL_TEST_DIR/home" \
  "$FROUTER_REAL_TEST_DIR/prefix" \
  "$FROUTER_REAL_TEST_DIR/logs"
chmod 700 "$FROUTER_REAL_TEST_DIR/home"
```

Suggested layout:

```text
.real-testing/
  home/      # isolated HOME used by frouter
  prefix/    # isolated npm global install prefix
  logs/      # captured command output / notes
```

## Preferred test flows

### 1) Clean smoke test with the latest published package

Use this when you want to verify the current official release without touching your real machine state:

```bash
env -u NVIDIA_API_KEY -u OPENROUTER_API_KEY \
  HOME="$FROUTER_REAL_TEST_DIR/home" \
  npx -y frouter-cli@latest --version | tee "$FROUTER_REAL_TEST_DIR/logs/version.txt"

env -u NVIDIA_API_KEY -u OPENROUTER_API_KEY \
  HOME="$FROUTER_REAL_TEST_DIR/home" \
  npx -y frouter-cli@latest
```

Verify:

- the package launches successfully
- first-run onboarding appears
- a new config is written only to `.real-testing/home/.frouter.json`
- your real `~/.frouter.json` is unchanged

### 2) Real “global install” flow in an isolated prefix

Use this when you want to test the same installation style users commonly use, without polluting your real global npm directory:

```bash
npm install -g frouter-cli@latest --prefix "$FROUTER_REAL_TEST_DIR/prefix"

PATH="$FROUTER_REAL_TEST_DIR/prefix/bin:$PATH" \
  HOME="$FROUTER_REAL_TEST_DIR/home" \
  frouter --version | tee "$FROUTER_REAL_TEST_DIR/logs/global-version.txt"

PATH="$FROUTER_REAL_TEST_DIR/prefix/bin:$PATH" \
  HOME="$FROUTER_REAL_TEST_DIR/home" \
  frouter
```

Verify:

- `frouter` resolves from `.real-testing/prefix/bin`
- the CLI starts cleanly
- onboarding, search, apply, and save flows behave the same as the `npx` flow

### 3) Pinned-version regression test

Use this to confirm a specific released version:

```bash
env -u NVIDIA_API_KEY -u OPENROUTER_API_KEY \
  HOME="$FROUTER_REAL_TEST_DIR/home" \
  npx -y frouter-cli@<version> --version
```

Examples:

- compare `@latest` vs an older released version
- reproduce a user-reported bug on the exact published version
- verify update flow from an older release

## Minimum real-testing checklist

For each real test run, capture:

1. tested package version (`frouter --version`)
2. install path used (`npx` or isolated global install)
3. OS + Node/npm/bun version if relevant
4. whether onboarding worked from an empty HOME
5. whether `.frouter.json` was created in the isolated HOME only
6. whether model search/apply still works
7. whether update flow works when testing an older published version

## Recommended scenarios

### Empty-home onboarding

- delete `.real-testing/home/.frouter.json` if it exists
- unset provider env vars
- run the published package
- confirm first-run behavior is correct

### Saved-config reuse

- keep `.real-testing/home/.frouter.json`
- rerun the published package
- confirm it reuses saved keys/settings from the isolated HOME

### Environment-variable precedence

- set only `NVIDIA_API_KEY` or `OPENROUTER_API_KEY`
- confirm env vars override the isolated saved config as intended

### Update flow

- install an older published version into `.real-testing/prefix`
- run `frouter`
- accept the in-app update prompt
- verify the binary reports the newer version after restart

## Logging guideline

Keep short notes in `.real-testing/logs/`, for example:

- `version.txt`
- `global-version.txt`
- `onboarding.txt`
- `update-flow.txt`

That keeps real-test evidence reproducible without mixing it into committed project files.

## Cleanup

When you are done:

```bash
rm -rf "$FROUTER_REAL_TEST_DIR"
```

Because `.real-testing/` is ignored by git, it is safe to use for disposable local verification artifacts.
