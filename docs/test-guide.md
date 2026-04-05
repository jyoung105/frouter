# frouter Test Guide

This guide explains two different test modes:

1. Local development test through the `frouter` command name (unpublished code)
2. Real-user test using the published npm package

Use both. They validate different risks.

## 1) Local command-path test (unpublished build)

Goal: verify current repo code can launch through `frouter` command semantics without installing from npm.

Run:

```bash
npm run build
npm run test:fresh-start
```

What this does:

- builds current local source to `dist/`
- runs onboarding with isolated `HOME`
- starts via a temporary local `frouter` command shim on `PATH`
- keeps your real `~/.frouter.json` untouched

Optional:

```bash
npm run test:fresh-start -- --keep-home
```

Use `--keep-home` when you want to inspect the generated temporary config.

## 2) Real published-package test

Goal: verify what users actually install and run from npm.

Follow the full procedure in:

- `docs/real-testing.md`

Quick smoke:

```bash
export FROUTER_REAL_TEST_DIR="$PWD/.real-testing"
mkdir -p "$FROUTER_REAL_TEST_DIR/home" "$FROUTER_REAL_TEST_DIR/prefix" "$FROUTER_REAL_TEST_DIR/logs"
chmod 700 "$FROUTER_REAL_TEST_DIR/home"

env -u NVIDIA_API_KEY -u OPENROUTER_API_KEY \
  HOME="$FROUTER_REAL_TEST_DIR/home" \
  npx -y frouter-cli@latest --version

env -u NVIDIA_API_KEY -u OPENROUTER_API_KEY \
  HOME="$FROUTER_REAL_TEST_DIR/home" \
  npx -y frouter-cli@latest
```

## Recommended routine before release

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `npm run test:fresh-start`
5. `docs/real-testing.md` smoke flow (`npx @latest`)

This order catches code issues first, then validates onboarding UX and published-package behavior.
