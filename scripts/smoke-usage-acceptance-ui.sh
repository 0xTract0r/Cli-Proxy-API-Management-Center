#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export OUT_DIR="${OUT_DIR:-${PROJECT_DIR}/build/playwright-usage-acceptance-smoke}"
export MANAGEMENT_UI_BASE="${MANAGEMENT_UI_BASE:-http://127.0.0.1:28017/management.html}"
export MANAGEMENT_API_BASE="${MANAGEMENT_API_BASE:-$(node -e 'const value = process.env.MANAGEMENT_UI_BASE || "http://127.0.0.1:28017/management.html"; const url = new URL(value); process.stdout.write(url.origin);')}"
export PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-${MANAGEMENT_UI_IGNORE_HTTPS_ERRORS:-}}"
export MANAGEMENT_KEY="${MANAGEMENT_KEY:-quotio-dev-management-key}"

mkdir -p "${OUT_DIR}"

echo "smoke-usage-acceptance-ui: MANAGEMENT_UI_BASE=${MANAGEMENT_UI_BASE}" >&2
echo "smoke-usage-acceptance-ui: MANAGEMENT_API_BASE=${MANAGEMENT_API_BASE}" >&2
echo "smoke-usage-acceptance-ui: PLAYWRIGHT_IGNORE_HTTPS_ERRORS=${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-false}" >&2
echo "smoke-usage-acceptance-ui: OUT_DIR=${OUT_DIR}" >&2
if [[ -n "${CPA_API_KEY:-${API_KEY:-}}" ]]; then
  echo "smoke-usage-acceptance-ui: /v1/models check enabled" >&2
else
  echo "smoke-usage-acceptance-ui: /v1/models check skipped; set CPA_API_KEY to enable" >&2
fi

npx playwright install chromium >/dev/null
npx playwright test \
  "${SCRIPT_DIR}/playwright-usage-acceptance-ui.smoke.spec.mjs" \
  --workers=1 \
  --reporter=line
