#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_HOME="$(mktemp -d "${TMPDIR:-/tmp}/frouter-onboarding.XXXXXX")"
KEEP_HOME=0

if [[ "${1:-}" == "--keep-home" ]]; then
  KEEP_HOME=1
  shift
fi

cleanup() {
  if [[ "${KEEP_HOME}" -eq 1 ]]; then
    printf '\nKept temp HOME for inspection: %s\n' "${TMP_HOME}"
    return
  fi
  rm -rf "${TMP_HOME}"
}
trap cleanup EXIT INT TERM

unset NVIDIA_API_KEY OPENROUTER_API_KEY

printf 'Running frouter in clean first-run mode.\n'
printf 'Isolated HOME: %s\n' "${TMP_HOME}"
printf 'Your real ~/.frouter.json is not touched.\n\n'
printf 'Onboarding tips:\n'
printf '  - Press ESC to skip a provider.\n'
printf '  - Enter y to open signup page for a provider key.\n\n'

HOME="${TMP_HOME}" node "${ROOT_DIR}/bin/frouter.js" "$@"

CONFIG_PATH="${TMP_HOME}/.frouter.json"
if [[ -f "${CONFIG_PATH}" ]]; then
  printf '\nTemp config written to %s\n' "${CONFIG_PATH}"
  cat "${CONFIG_PATH}"
  printf '\n'
else
  printf '\nNo config file was written in temp HOME.\n'
fi
