#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export OUT_DIR="${OUT_DIR:-${PROJECT_DIR}/build/playwright-farm-smoke}"
export MANAGEMENT_UI_BASE="${MANAGEMENT_UI_BASE:-http://127.0.0.1:28017/management.html}"
export MANAGEMENT_UI_ROUTE="${MANAGEMENT_UI_ROUTE:-#/farm}"
export PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-${MANAGEMENT_UI_IGNORE_HTTPS_ERRORS:-}}"
export FARM_ADMIN_KEY="${FARM_ADMIN_KEY:-farm-smoke-admin-key}"

mkdir -p "${OUT_DIR}"

echo "smoke-farm-ui: MANAGEMENT_UI_BASE=${MANAGEMENT_UI_BASE}" >&2
echo "smoke-farm-ui: MANAGEMENT_UI_ROUTE=${MANAGEMENT_UI_ROUTE}" >&2
echo "smoke-farm-ui: PLAYWRIGHT_IGNORE_HTTPS_ERRORS=${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-false}" >&2
echo "smoke-farm-ui: OUT_DIR=${OUT_DIR}" >&2

npx playwright install chromium >/dev/null
npx playwright test \
  "${SCRIPT_DIR}/playwright-farm-ui.smoke.spec.mjs" \
  "${SCRIPT_DIR}/playwright-farm-ia.smoke.spec.mjs" \
  --workers=1 \
  --reporter=line
