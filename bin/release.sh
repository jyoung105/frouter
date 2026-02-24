#!/usr/bin/env bash
# release.sh — Bump version, commit, tag, and push for automated npm publish
#
# Usage:
#   ./bin/release.sh patch    # 1.1.0 → 1.1.1
#   ./bin/release.sh minor    # 1.1.0 → 1.2.0
#   ./bin/release.sh major    # 1.1.0 → 2.0.0
#   ./bin/release.sh 1.2.3    # explicit version
#
# What it does:
#   1. Bumps version in package.json
#   2. Commits the version bump
#   3. Creates a git tag (v1.2.3)
#   4. Pushes commit + tag → triggers .github/workflows/release.yml
#
# Prerequisites:
#   - Clean working tree (no uncommitted changes)
#   - NPM_TOKEN secret configured in GitHub repo settings

set -euo pipefail

BUMP="${1:-}"

if [ -z "$BUMP" ]; then
  echo "Usage: ./bin/release.sh <patch|minor|major|x.y.z>"
  exit 1
fi

# Ensure clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Ensure on main branch
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "Warning: You are on branch '$BRANCH', not 'main'."
  read -rp "Continue anyway? (y/N) " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    exit 1
  fi
fi

# Get current version
OLD_VERSION=$(node -p "require('./package.json').version")

# Determine new version
case "$BUMP" in
  patch|minor|major)
    IFS='.' read -r MAJOR MINOR PATCH <<< "$OLD_VERSION"
    case "$BUMP" in
      patch) PATCH=$((PATCH + 1)) ;;
      minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
      major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    esac
    NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
    ;;
  *)
    # Validate semver format
    if ! echo "$BUMP" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
      echo "Error: '$BUMP' is not a valid semver (x.y.z)"
      exit 1
    fi
    NEW_VERSION="$BUMP"
    ;;
esac

TAG="v${NEW_VERSION}"

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag '$TAG' already exists."
  exit 1
fi

echo ""
echo "  Version bump: $OLD_VERSION → $NEW_VERSION"
echo "  Tag:          $TAG"
echo "  Branch:       $BRANCH"
echo ""
read -rp "Proceed? (y/N) " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

# Bump version in package.json (no git operations from npm version)
npm version "$NEW_VERSION" --no-git-tag-version

# Commit and tag
git add package.json package-lock.json 2>/dev/null || git add package.json
git commit -m "chore: bump version to $NEW_VERSION"
git tag -a "$TAG" -m "Release $TAG"

echo ""
echo "Created commit and tag $TAG locally."
echo ""
read -rp "Push to origin? (y/N) " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "Skipped push. Run manually:"
  echo "  git push origin $BRANCH $TAG"
  exit 0
fi

git push origin "$BRANCH" "$TAG"

echo ""
echo "Pushed $TAG — release workflow will publish to npm."
echo "Monitor: https://github.com/jyoung105/frouter/actions"
