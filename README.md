```
 ███████╗ ██████╗  ███████╗ ███████╗          ██████╗   ██████╗  ██╗   ██╗ ████████╗ ███████╗ ██████╗
 ██╔════╝ ██╔══██╗ ██╔════╝ ██╔════╝          ██╔══██╗ ██╔═══██╗ ██║   ██║ ╚══██╔══╝ ██╔════╝ ██╔══██╗
 █████╗   ██████╔╝ █████╗   █████╗   ██████╗  ██████╔╝ ██║   ██║ ██║   ██║    ██║    █████╗   ██████╔╝
 ██╔══╝   ██╔══██╗ ██╔══╝   ██╔══╝   ╚═════╝  ██╔══██╗ ██║   ██║ ██║   ██║    ██║    ██╔══╝   ██╔══██╗
 ██║      ██║  ██║ ███████╗ ███████╗          ██║  ██║ ╚██████╔╝ ╚██████╔╝    ██║    ███████╗ ██║  ██║
 ╚═╝      ╚═╝  ╚═╝ ╚══════╝ ╚══════╝          ╚═╝  ╚═╝  ╚═════╝   ╚═════╝     ╚═╝    ╚══════╝ ╚═╝  ╚═╝
```

[English](./README.md) | [한국어](./README.ko.md)

![Version](https://img.shields.io/badge/version-1.2.0-333333?style=flat-square)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![npm downloads](https://img.shields.io/npm/dm/free-router)](https://www.npmjs.com/package/free-router)
[![CI](https://github.com/jyoung105/free-router/actions/workflows/ci.yml/badge.svg)](https://github.com/jyoung105/free-router/actions/workflows/ci.yml)

Free model router CLI — discover, ping, and configure free AI models for OpenCode / OpenClaw.

![free-router-gif](./public/example.gif)

## Install

```bash
npx free-router
# or
npm i -g free-router
# or
bunx free-router
# or
bun install -g free-router
```

## Run

```bash
free-router
```

On first run, a setup wizard prompts for API keys (ESC to skip any provider).

If you accept the in-app update prompt (`Y`), free-router now updates globally and
restarts automatically, so you can continue without running `free-router` again.

## Ways to use free-router

1. **First-run onboarding wizard**
   Launch `free-router`, open provider websites in-browser from the wizard, paste keys, and start.
2. **Interactive model search + launch**
   Use `/` to filter models, then `Enter` to update OpenCode config and open `opencode`.
3. **Quick API key rescue from main screen**
   Press `A` (or `R` for expired/missing provider) to jump into key editing with auto browser opening for missing keys.
4. **Full settings workflow**
   Press `P` to edit keys, toggle providers, run live key tests, and onboard missing keys provider-by-provider.
5. **Non-interactive best-model selection**
   Run `free-router --best` to print the best responding model ID for scripts.

## First-run onboarding test (clean state)

Use an isolated temporary `HOME` to test onboarding from zero without deleting your real install/config:

```bash
npm run test:onboarding
npm run test:fresh-start
```

`test:fresh-start` launches interactive onboarding with:

- no `~/.free-router.json` in the temp home
- provider env keys unset (`NVIDIA_API_KEY`, `OPENROUTER_API_KEY`)
- your real `~/.free-router.json` untouched

Optional:

```bash
npm run test:fresh-start -- --keep-home
```

This keeps the temp `HOME` path after exit for inspection.

## Providers

| Provider       | Free key                                                                             |
| -------------- | ------------------------------------------------------------------------------------ |
| **NVIDIA NIM** | [build.nvidia.com](https://build.nvidia.com/settings/api-keys) — prefix `nvapi-`     |
| **OpenRouter** | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) — prefix `sk-or-` |

API key priority: environment variable → `~/.free-router.json` → keyless ping (latency still shown).

```bash
NVIDIA_API_KEY=nvapi-xxx free-router
OPENROUTER_API_KEY=sk-or-xxx free-router

# Optional: pause auto re-sorting while you scroll (milliseconds)
FREE_ROUTER_SCROLL_SORT_PAUSE_MS=2500 free-router

# Optional: disable rolling metrics cache and force legacy recompute path
FREE_ROUTER_METRICS_CACHE=0 free-router
```

## TUI

The interactive TUI pings all models in parallel every 2 seconds and shows live latency, uptime, and verdict.

### Columns

| Column     | Description                                                    |
| ---------- | -------------------------------------------------------------- |
| `#`        | Rank                                                           |
| `Tier`     | Capability tier derived from SWE-bench score (S+ → C)          |
| `Provider` | NIM or OpenRouter                                              |
| `Model`    | Display name                                                   |
| `Ctx`      | Context window size                                            |
| `AA`       | Arena Elo / intelligence score                                 |
| `Avg`      | Rolling average latency (HTTP 200 only)                        |
| `Lat`      | Latest measured ping latency                                   |
| `Up%`      | Uptime percentage this session                                 |
| `Verdict`  | Condition summary (🚀 Perfect / ✅ Normal / 🔥 Overloaded / …) |

Default ranking: **availability first**, then **higher tier first** (S+ → S → A+ …), then lower latency.

Search bar provider badges:

- `Name:✓` key exists and looks healthy
- `Name:✗` provider appears expired/no-auth
- `Name:○` key missing

### Keyboard shortcuts

**Navigation**

| Key             | Action         |
| --------------- | -------------- |
| `↑` / `k`       | Move up        |
| `↓` / `j`       | Move down      |
| `PgUp` / `PgDn` | Page up / down |
| `g`             | Jump to top    |
| `G`             | Jump to bottom |

**Actions**

| Key            | Action                                                     |
| -------------- | ---------------------------------------------------------- |
| `Enter`        | Save config + open current model in `opencode`             |
| `/`            | Search / filter models (Enter in search = open `opencode`) |
| `A`            | Quick API key add/change (opens key editor in Settings)    |
| `R`            | Edit API key for likely expired/missing provider           |
| `T`            | Cycle tier filter: All → S+ → S → A+ → …                   |
| `P`            | Settings screen (edit keys, toggle providers, test)        |
| `W` / `X`      | Faster / slower ping interval                              |
| `?`            | Help overlay                                               |
| `q` / `Ctrl+C` | Quit                                                       |

**Sort** (press to sort, press again to reverse)

| Key | Column             |
| --- | ------------------ |
| `0` | Priority (default) |
| `1` | Tier               |
| `2` | Provider           |
| `3` | Model name         |
| `4` | Avg latency        |
| `5` | Latest ping        |
| `6` | Uptime %           |
| `7` | Context window     |
| `8` | Verdict            |
| `9` | AA Intelligence    |

### OpenCode handoff

Pressing `Enter` on a model writes the OpenCode config and immediately opens `opencode`.

If OpenCode fallback remaps the provider (for example NIM Stepfun → OpenRouter)
and the effective provider key is missing, free-router asks:
`Add API key now? (Y/n, default: Y)`.

Configs written:

- **OpenCode CLI** → `~/.config/opencode/opencode.json`
- **OpenClaw** → `~/.openclaw/openclaw.json`

Existing configs are backed up before writing.

When free-router launches OpenCode, it now sets `OPENCODE_CLI_RUN_MODE=true`
by default (unless you already set it) to reduce startup log noise from
plugin auto-update checks in the OpenCode TUI.

If you want OpenCode's default startup hook behavior instead, launch free-router with:

```bash
OPENCODE_CLI_RUN_MODE=false free-router
```

### Settings screen (`P`)

Tip: press `A` from the main list to jump directly into API key editing.
Tip: if a selected provider has no key, free-router auto-opens that provider key page
in browser (once per provider per settings session), including when you move selection.

| Key                   | Action                             |
| --------------------- | ---------------------------------- |
| `↑` / `↓` / `j` / `k` | Navigate providers                 |
| `Enter`               | Edit API key inline                |
| `Space`               | Toggle provider enabled / disabled |
| `T`                   | Fire a live test ping              |
| `D`                   | Delete key for this provider       |
| `ESC`                 | Back to main list                  |

## Flags

| Flag            | Behavior                                                      |
| --------------- | ------------------------------------------------------------- |
| _(none)_        | Interactive TUI                                               |
| `--best`        | Non-interactive: ping 4 rounds, print best model ID to stdout |
| `--help` / `-h` | Show help                                                     |

### `--best` scripted usage

```bash
# Print best model ID after ~10 s analysis
free-router --best

# Capture in a variable
MODEL=$(free-router --best)
echo "Best model: $MODEL"
```

Requires at least one API key to be configured. Selection tri-key sort: status=up → lowest avg latency → highest uptime.

## Config

Stored at `~/.free-router.json` (permissions `0600`).

```json
{
  "apiKeys": {
    "nvidia": "nvapi-xxx",
    "openrouter": "sk-or-xxx"
  },
  "providers": {
    "nvidia": { "enabled": true },
    "openrouter": { "enabled": true }
  },
  "ui": {
    "scrollSortPauseMs": 1500
  }
}
```

`ui.scrollSortPauseMs` sets how long (ms) auto re-sorting stays paused after navigation input.
`FREE_ROUTER_SCROLL_SORT_PAUSE_MS` overrides config. Set to `0` to disable pause.

## Tier scale (SWE-bench Verified)

| Tier   | Score  | Description        |
| ------ | ------ | ------------------ |
| **S+** | ≥ 70%  | Elite frontier     |
| **S**  | 60–70% | Excellent          |
| **A+** | 50–60% | Great              |
| **A**  | 40–50% | Good               |
| **A-** | 35–40% | Decent             |
| **B+** | 30–35% | Average            |
| **B**  | 20–30% | Below average      |
| **C**  | < 20%  | Lightweight / edge |

## Verdict legend

| Verdict       | Trigger                   |
| ------------- | ------------------------- |
| 🔥 Overloaded | Last HTTP code = 429      |
| ⚠️ Unstable   | Was up, now failing       |
| 👻 Not Active | Never responded           |
| ⏳ Pending    | Waiting for first success |
| 🚀 Perfect    | Avg < 400 ms              |
| ✅ Normal     | Avg < 1000 ms             |
| 🐢 Slow       | Avg < 3000 ms             |
| 🐌 Very Slow  | Avg < 5000 ms             |
| 💀 Unusable   | Avg ≥ 5000 ms             |

## Test

```bash
npm run lint
npm test
npm run typecheck

# optional perf workflow
npm run perf:baseline
npm run test:perf
```

## Engineering workflow

For branch strategy (`dev`/`main`), SemVer rules, PR/issue governance, and release tags
(`cli-v*`, `site-v*`), see [`docs/release-governance.md`](./docs/release-governance.md).

## Model catalog auto-sync (GitHub Actions)

`free-router` includes a scheduled workflow to keep model metadata current:

- Workflow: `.github/workflows/model-catalog-sync.yml`
- Triggers:
  - Daily: `17 3 * * *` (UTC)
  - Weekly AA refresh: `47 4 * * 1` (UTC)
  - Manual: `workflow_dispatch`
- Updates:
  - `model-rankings.json`
  - `model-support.json` (OpenCode support map)
- If changes exist, it opens/updates a PR on `chore/model-catalog-sync`.
- If unresolved new-model tiers remain, PR gets `needs-tier-review`.

Repository secrets used by this workflow:

- `NVIDIA_API_KEY`
- `OPENROUTER_API_KEY`
- `ARTIFICIAL_ANALYSIS_API_KEY`

Local sync commands:

```bash
npm run models:sync
npm run models:sync:apply
```

## Development notes

- TypeScript source of truth: `src/` (app + tests)
- ESLint config is TypeScript: `eslint.config.ts`
- Runtime JS output is generated only in `dist/` via `npm run build`
- Tests run from compiled `dist/tests/` output after build

## License

MIT. See [LICENSE](./LICENSE).
