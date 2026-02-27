#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required: https://cli.github.com/"
  exit 1
fi

REPO_INPUT="${1:-}"
if [[ -z "$REPO_INPUT" ]]; then
  REPO_INPUT="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi

OWNER="${REPO_INPUT%%/*}"
REPO="${REPO_INPUT##*/}"

if [[ "$OWNER" == "$REPO_INPUT" ]]; then
  echo "Usage: $0 <owner/repo>"
  exit 1
fi

read -r -d '' PAYLOAD <<'JSON' || true
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "CI / Test (Node 20 on ubuntu-latest)",
      "CI / Test (Node 20 on macos-latest)",
      "CI / Test (Node 22 on ubuntu-latest)",
      "CI / Test (Node 22 on macos-latest)",
      "CI / Site build (Node 22 on ubuntu-latest)",
      "PR Governance / Branch + PR policy"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_linear_history": false,
  "lock_branch": false,
  "allow_fork_syncing": true
}
JSON

for branch in main dev; do
  echo "Applying branch protection to ${OWNER}/${REPO}:${branch}"
  gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "/repos/${OWNER}/${REPO}/branches/${branch}/protection" \
    --input - <<<"$PAYLOAD" >/dev/null
  echo "  ✓ ${branch} updated"
done

echo "Done."
