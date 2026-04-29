#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export OUT_DIR="${OUT_DIR:-${PROJECT_DIR}/build/playwright-auth-files-smoke}"
export MANAGEMENT_UI_BASE="${MANAGEMENT_UI_BASE:-http://127.0.0.1:28017/management.html}"
export MANAGEMENT_UI_ROUTE="${MANAGEMENT_UI_ROUTE:-#/auth-files}"
export PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-${MANAGEMENT_UI_IGNORE_HTTPS_ERRORS:-}}"
DEFAULT_DEV_KEYCHAIN_SERVICE="${DEFAULT_DEV_KEYCHAIN_SERVICE:-dev.quotio.desktop.local-management.dev}"

if [[ -z "${MANAGEMENT_KEY:-}" ]]; then
  MANAGEMENT_KEY="$(security find-generic-password -s "${DEFAULT_DEV_KEYCHAIN_SERVICE}" -a local-management-key -w 2>/dev/null || true)"
fi

export MANAGEMENT_KEY="${MANAGEMENT_KEY:-}"

if [[ -z "${MANAGEMENT_KEY}" ]]; then
  echo "Failed to resolve MANAGEMENT_KEY; pass it explicitly or ensure Keychain service ${DEFAULT_DEV_KEYCHAIN_SERVICE} is readable." >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

echo "smoke-auth-files-ui: MANAGEMENT_UI_BASE=${MANAGEMENT_UI_BASE}" >&2
echo "smoke-auth-files-ui: MANAGEMENT_UI_ROUTE=${MANAGEMENT_UI_ROUTE}" >&2
echo "smoke-auth-files-ui: PLAYWRIGHT_IGNORE_HTTPS_ERRORS=${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-false}" >&2
echo "smoke-auth-files-ui: OUT_DIR=${OUT_DIR}" >&2

npx playwright install chromium >/dev/null
npx playwright test \
  "${SCRIPT_DIR}/playwright-auth-files-ui.smoke.spec.mjs" \
  --workers=1 \
  --reporter=line
