#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export OUT_DIR="${OUT_DIR:-${PROJECT_DIR}/build/playwright-usage-live-data-smoke}"
export MANAGEMENT_UI_BASE="${MANAGEMENT_UI_BASE:-http://127.0.0.1:28017/management.html}"
export MANAGEMENT_API_BASE="${MANAGEMENT_API_BASE:-}"
export PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-${MANAGEMENT_UI_IGNORE_HTTPS_ERRORS:-}}"
export MANAGEMENT_KEY="${MANAGEMENT_KEY:-}"

if [[ -z "${MANAGEMENT_KEY:-}" && "${READ_REMOTE_MANAGEMENT_KEY:-0}" == "1" ]]; then
  REMOTE_HOST="${REMOTE_HOST:-wisedata@10.1.1.201}"
  DEPLOY_DIR="${DEPLOY_DIR:-/home/wisedata/deploy/cliproxyapi-plus-oauth-test}"
  REMOTE_MANAGEMENT_SECRET_FILE="${REMOTE_MANAGEMENT_SECRET_FILE:-${DEPLOY_DIR}/runtime/secrets.env}"
  MANAGEMENT_KEY="$(ssh "${REMOTE_HOST}" "set -euo pipefail; set -a; . '${REMOTE_MANAGEMENT_SECRET_FILE}'; set +a; printf '%s' \"\${MANAGEMENT_PASSWORD:-}\"")"
  export MANAGEMENT_KEY
fi

if [[ -z "${MANAGEMENT_KEY:-}" ]]; then
  echo "smoke-usage-live-data-ui: MANAGEMENT_KEY is required; set it directly or use READ_REMOTE_MANAGEMENT_KEY=1" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"
cd "${PROJECT_DIR}"

echo "smoke-usage-live-data-ui: MANAGEMENT_UI_BASE=${MANAGEMENT_UI_BASE}" >&2
echo "smoke-usage-live-data-ui: MANAGEMENT_API_BASE=${MANAGEMENT_API_BASE:-<origin>}" >&2
echo "smoke-usage-live-data-ui: MANAGEMENT_KEY=<set>" >&2
echo "smoke-usage-live-data-ui: PLAYWRIGHT_IGNORE_HTTPS_ERRORS=${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-false}" >&2
echo "smoke-usage-live-data-ui: OUT_DIR=${OUT_DIR}" >&2

npx playwright test \
  "${SCRIPT_DIR}/playwright-usage-live-data-ui.smoke.spec.mjs" \
  --workers=1 \
  --reporter=line \
  --trace=retain-on-failure
