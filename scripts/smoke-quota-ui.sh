#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export OUT_DIR="${OUT_DIR:-${PROJECT_DIR}/build/playwright-quota-smoke}"
export MANAGEMENT_UI_BASE="${MANAGEMENT_UI_BASE:-http://127.0.0.1:28017/management.html}"
export MANAGEMENT_UI_ROUTE="${MANAGEMENT_UI_ROUTE:-#/quota}"
export PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-${MANAGEMENT_UI_IGNORE_HTTPS_ERRORS:-}}"
export MANAGEMENT_KEY="${MANAGEMENT_KEY:-quotio-dev-management-key}"

mkdir -p "${OUT_DIR}"

echo "smoke-quota-ui: MANAGEMENT_UI_BASE=${MANAGEMENT_UI_BASE}" >&2
echo "smoke-quota-ui: MANAGEMENT_UI_ROUTE=${MANAGEMENT_UI_ROUTE}" >&2
echo "smoke-quota-ui: PLAYWRIGHT_IGNORE_HTTPS_ERRORS=${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-false}" >&2
echo "smoke-quota-ui: OUT_DIR=${OUT_DIR}" >&2

npx playwright install chromium >/dev/null
npx playwright test \
  "${SCRIPT_DIR}/playwright-quota-ui.smoke.spec.mjs" \
  --workers=1 \
  --reporter=line
