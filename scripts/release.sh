#!/usr/bin/env bash
# release.sh — release helper for CLI and site with double-branch workflow.
#
# Usage:
#   # Prepare release commit on release/* branch
#   ./scripts/release.sh prepare cli patch
#   ./scripts/release.sh prepare site minor --push
#
#   # Shorthand (defaults to CLI prepare mode)
#   ./scripts/release.sh patch
#   ./scripts/release.sh minor --push
#
#   # Create release tags on main after release PR merge
#   ./scripts/release.sh tag cli --push
#   ./scripts/release.sh tag site --push
#
# Options:
#   --push             Push prepared release branch (prepare) or tags (tag)
#   --yes, -y          Non-interactive confirmation
#   --legacy-cli-tag   Also create/push legacy CLI tag format: vX.Y.Z

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ASSUME_YES=0
PUSH=0
LEGACY_CLI_TAG=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release.sh prepare <cli|site> <major|minor|patch|x.y.z> [--push] [--yes]
  ./scripts/release.sh tag <cli|site> [--push] [--yes] [--legacy-cli-tag]

Shorthand:
  ./scripts/release.sh <major|minor|patch|x.y.z> [--push] [--yes]
  # Equivalent to: ./scripts/release.sh prepare cli <bump>

Examples:
  ./scripts/release.sh prepare cli patch --push
  ./scripts/release.sh prepare site minor
  ./scripts/release.sh patch --push
  ./scripts/release.sh tag cli --push
  ./scripts/release.sh tag site --push
EOF
}

die() {
  echo "Error: $*" >&2
  exit 1
}

is_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

is_bump_spec() {
  [[ "$1" =~ ^(major|minor|patch)$ ]] || is_semver "$1"
}

ensure_target() {
  case "$1" in
    cli|site) ;;
    *) die "Target must be 'cli' or 'site' (got: $1)" ;;
  esac
}

ensure_clean_tree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    die "Working tree is not clean. Commit or stash changes first."
  fi
}

confirm_or_abort() {
  local prompt="$1"
  if [[ "$ASSUME_YES" -eq 1 ]]; then
    return 0
  fi

  read -r -p "${prompt} (y/N) " answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
}

next_version() {
  local old="$1"
  local bump="$2"

  if is_semver "$bump"; then
    echo "$bump"
    return 0
  fi

  local major minor patch
  IFS='.' read -r major minor patch <<<"$old"

  case "$bump" in
    patch)
      patch=$((patch + 1))
      ;;
    minor)
      minor=$((minor + 1))
      patch=0
      ;;
    major)
      major=$((major + 1))
      minor=0
      patch=0
      ;;
    *)
      die "Invalid bump value: $bump"
      ;;
  esac

  echo "${major}.${minor}.${patch}"
}

set_package_version() {
  local package_file="$1"
  local new_version="$2"

  node -e '
const fs = require("fs");
const packageFile = process.argv[1];
const version = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
pkg.version = version;
fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);
' "$package_file" "$new_version"
}

tag_exists_local() {
  local tag="$1"
  git rev-parse -q --verify "refs/tags/${tag}" >/dev/null 2>&1
}

prepare_release() {
  local target="$1"
  local bump="$2"
  local branch old_version new_version tag

  ensure_target "$target"
  if ! is_bump_spec "$bump"; then
    die "Bump must be one of major/minor/patch/x.y.z (got: $bump)"
  fi

  ensure_clean_tree

  branch="$(git branch --show-current)"
  if [[ ! "$branch" =~ ^release/ ]]; then
    die "Prepare mode must run on a release/* branch (current: ${branch})"
  fi

  case "$target" in
    cli)
      old_version="$(node -p "require('./package.json').version")"
      new_version="$(next_version "$old_version" "$bump")"
      tag="cli-v${new_version}"

      if [[ "$old_version" == "$new_version" ]]; then
        die "Current CLI version is already ${new_version}"
      fi

      confirm_or_abort "Prepare CLI release on ${branch}: ${old_version} -> ${new_version}"

      set_package_version "./package.json" "$new_version"

      git add package.json

      git commit -m "chore(release): cli v${new_version}"
      ;;

    site)
      old_version="$(node -p "require('./site/package.json').version")"
      new_version="$(next_version "$old_version" "$bump")"
      tag="site-v${new_version}"

      if [[ "$old_version" == "$new_version" ]]; then
        die "Current site version is already ${new_version}"
      fi

      confirm_or_abort "Prepare site release on ${branch}: ${old_version} -> ${new_version}"

      set_package_version "./site/package.json" "$new_version"

      git add site/package.json

      git commit -m "chore(release): site v${new_version}"
      ;;

    *)
      die "Unsupported target: ${target}"
      ;;
  esac

  echo
  echo "Prepared ${target} release: ${old_version} -> ${new_version}"
  echo "Candidate tag after merge to main: ${tag}"

  if [[ "$PUSH" -eq 1 ]]; then
    git push origin "$branch"
    echo "Pushed ${branch} to origin."
  else
    echo "Not pushed yet. Push when ready: git push origin ${branch}"
  fi

  echo
  echo "Next steps:"
  echo "  1) Open/merge PR: ${branch} -> main"
  echo "  2) Sync local main"
  echo "  3) Run: ./scripts/release.sh tag ${target} --push"
  if [[ "$target" == "cli" ]]; then
    echo "     (optional legacy tag) ./scripts/release.sh tag cli --push --legacy-cli-tag"
  fi
}

create_tag() {
  local target="$1"
  local branch version tag legacy_tag

  ensure_target "$target"
  ensure_clean_tree

  branch="$(git branch --show-current)"
  if [[ "$branch" != "main" ]]; then
    die "Tag mode must run on main branch (current: ${branch})"
  fi

  case "$target" in
    cli)
      version="$(node -p "require('./package.json').version")"
      tag="cli-v${version}"
      ;;
    site)
      version="$(node -p "require('./site/package.json').version")"
      tag="site-v${version}"
      ;;
    *)
      die "Unsupported target: ${target}"
      ;;
  esac

  if tag_exists_local "$tag"; then
    die "Tag ${tag} already exists locally"
  fi

  legacy_tag=""
  if [[ "$target" == "cli" && "$LEGACY_CLI_TAG" -eq 1 ]]; then
    legacy_tag="v${version}"
    if tag_exists_local "$legacy_tag"; then
      die "Legacy tag ${legacy_tag} already exists locally"
    fi
  fi

  if [[ -n "$legacy_tag" ]]; then
    confirm_or_abort "Create tags ${tag} and ${legacy_tag} on main"
  else
    confirm_or_abort "Create tag ${tag} on main"
  fi

  git tag -a "$tag" -m "Release ${tag}"
  if [[ -n "$legacy_tag" ]]; then
    git tag -a "$legacy_tag" -m "Release ${legacy_tag}"
  fi

  echo
  echo "Created tag(s):"
  echo "  - ${tag}"
  if [[ -n "$legacy_tag" ]]; then
    echo "  - ${legacy_tag}"
  fi

  if [[ "$PUSH" -eq 1 ]]; then
    if [[ -n "$legacy_tag" ]]; then
      git push origin "$tag" "$legacy_tag"
    else
      git push origin "$tag"
    fi
    echo "Pushed tag(s) to origin."
  else
    if [[ -n "$legacy_tag" ]]; then
      echo "Not pushed yet. Push manually: git push origin ${tag} ${legacy_tag}"
    else
      echo "Not pushed yet. Push manually: git push origin ${tag}"
    fi
  fi

  echo
  echo "Release workflow monitor: https://github.com/jyoung105/frouter/actions"
}

main() {
  if [[ $# -eq 0 ]]; then
    usage
    exit 1
  fi

  local mode="prepare"

  if [[ "${1:-}" == "prepare" || "${1:-}" == "tag" ]]; then
    mode="$1"
    shift
  fi

  local positional=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --push)
        PUSH=1
        ;;
      --yes|-y)
        ASSUME_YES=1
        ;;
      --legacy-cli-tag)
        LEGACY_CLI_TAG=1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        positional+=("$1")
        ;;
    esac
    shift
  done

  set -- "${positional[@]}"

  if [[ "$mode" == "prepare" ]]; then
    local target bump

    # Backward-compatible shorthand: ./scripts/release.sh patch
    if [[ $# -eq 1 ]] && is_bump_spec "$1"; then
      target="cli"
      bump="$1"
    elif [[ $# -eq 2 ]]; then
      target="$1"
      bump="$2"
    else
      usage
      exit 1
    fi

    prepare_release "$target" "$bump"
    return 0
  fi

  if [[ "$mode" == "tag" ]]; then
    if [[ $# -ne 1 ]]; then
      usage
      exit 1
    fi

    create_tag "$1"
    return 0
  fi

  die "Unknown mode: ${mode}"
}

main "$@"
