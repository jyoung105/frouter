# Release Governance (CLI + Site)

This repository uses **independent SemVer** for each deliverable:

- CLI package: `package.json` (`frouter-cli`)
- Site package: `site/package.json` (`frouter-site`)

## 1) SemVer policy (major/minor/patch)

### frouter CLI (`frouter-cli`)

- **MAJOR** (`X.0.0`): breaking CLI contract
  - renamed/removed flags or commands
  - changed stdout format used by scripts
  - changed config schema requiring user migration
- **MINOR** (`x.Y.0`): backward-compatible feature
  - new flags/commands
  - new provider support that does not break existing usage
- **PATCH** (`x.y.Z`): backward-compatible fixes
  - bug fixes, security fixes, performance tuning, docs-only behavior clarifications

### site (`frouter-site`)

- **MAJOR**: breaking information architecture/routing/data contract for consumers
- **MINOR**: new pages/features/components without breaking existing URLs/API
- **PATCH**: bug fixes/content fixes/style fixes

> Rule: if users need to change behavior/scripts/config, it is **major**.

## 2) Branch strategy (double-branch)

- `main` = production-ready only (publish source of truth)
- `dev` = integration/testing branch
- `feature/*`, `fix/*`, `chore/*`, `docs/*`, `refactor/*`, `test/*`, `ci/*` = work branches from `dev`
- `release/*` = release hardening branch from `dev` (e.g. `release/cli-v1.2.0`, `release/site-v0.2.0`)
- `hotfix/*` = urgent production fix from `main`

Initial setup (one-time):

```bash
git checkout main
git pull
git checkout -b dev
git push -u origin dev
```

### Mandatory flow

1. Create issue
2. Branch from `dev`
3. PR to `dev`
4. Cut `release/*` from `dev`
5. Stabilize + version bump in `release/*`
6. PR `release/*` to `main`
7. Tag on `main` and publish
8. Back-merge `main` -> `dev`

## 3) Tag strategy

Use explicit target prefixes:

- CLI release tag: `cli-vX.Y.Z`
- Site release tag: `site-vA.B.C`

Legacy CLI tags (`vX.Y.Z`) are still accepted, but `cli-vX.Y.Z` is recommended.
All tags are validated against `package.json` versions by CI release jobs.

## 4) PR/Issue governance

- Use issue templates (`bug`, `feature`, `release request`)
- Use PR template and include `Closes #<issue>`
- PR title must follow Conventional Commits (enforced by workflow)
- PRs to `main` are allowed only from `release/*` or `hotfix/*`
- PRs to `dev` must not come from `release/*` or `hotfix/*`
- Bot PRs (`github-actions[bot]`, `dependabot[bot]`) are exempt from strict flow checks

## 5) Branch protection settings (GitHub)

Apply to **both `main` and `dev`**:

- Require pull request before merge
- Require at least 1 approval
- Dismiss stale approvals on new commits
- Require conversation resolution
- Require status checks to pass before merge:
  - `CI / Test (Node 20 on ubuntu-latest)`
  - `CI / Test (Node 20 on macos-latest)`
  - `CI / Test (Node 22 on ubuntu-latest)`
  - `CI / Test (Node 22 on macos-latest)`
  - `CI / Site build (Node 22 on ubuntu-latest)`
  - `PR Governance / Branch + PR policy`
- Restrict who can push directly (no direct push except admins if needed)

You can apply this policy via CLI (repo admin required):

```bash
./scripts/apply-branch-protection.sh owner/repo
```

## 6) Release execution checklist

Use the automation script in `scripts/release.sh`.

### CLI release (`major` / `minor` / `patch`)

```bash
# from release/* branch
./scripts/release.sh prepare cli patch --push

# open/merge PR: release/* -> main

git checkout main
git pull

# create/push tag and trigger Release workflow
./scripts/release.sh tag cli --push

# optional (instead of previous line): include legacy CLI tag format too
./scripts/release.sh tag cli --push --legacy-cli-tag
```

### Site release (`major` / `minor` / `patch`)

```bash
# from release/* branch
./scripts/release.sh prepare site patch --push

# open/merge PR: release/* -> main

git checkout main
git pull

# create/push tag and trigger Release workflow
./scripts/release.sh tag site --push
```

Shorthand is available for CLI:

```bash
./scripts/release.sh patch --push
```

The `Release` workflow handles:

- `cli-v*` (and legacy `v*`): lint/typecheck/build/tests + npm publish + GitHub release
- `site-v*`: site build + artifact packaging + GitHub release
