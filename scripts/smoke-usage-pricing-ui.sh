#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export OUT_DIR="${OUT_DIR:-${PROJECT_DIR}/build/playwright-usage-pricing-smoke}"
export MANAGEMENT_UI_BASE="${MANAGEMENT_UI_BASE:-http://127.0.0.1:28017/management.html}"
export MANAGEMENT_UI_ROUTE="${MANAGEMENT_UI_ROUTE:-#/usage}"
export PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-${MANAGEMENT_UI_IGNORE_HTTPS_ERRORS:-}}"
export MANAGEMENT_KEY="${MANAGEMENT_KEY:-}"
export RUN_PRICING_REFRESH="${RUN_PRICING_REFRESH:-0}"
export REQUIRE_PRICING_PERSISTED_AT="${REQUIRE_PRICING_PERSISTED_AT:-1}"

if [[ -z "${MANAGEMENT_KEY:-}" && "${READ_REMOTE_MANAGEMENT_KEY:-0}" == "1" ]]; then
  REMOTE_HOST="${REMOTE_HOST:-wisedata@10.1.1.201}"
  DEPLOY_DIR="${DEPLOY_DIR:-/home/wisedata/deploy/cliproxyapi-plus-oauth-test}"
  REMOTE_MANAGEMENT_SECRET_FILE="${REMOTE_MANAGEMENT_SECRET_FILE:-${DEPLOY_DIR}/runtime/secrets.env}"
  MANAGEMENT_KEY="$(ssh "${REMOTE_HOST}" "set -euo pipefail; set -a; . '${REMOTE_MANAGEMENT_SECRET_FILE}'; set +a; printf '%s' \"\${MANAGEMENT_PASSWORD:-}\"")"
  export MANAGEMENT_KEY
fi

if [[ -z "${MANAGEMENT_KEY:-}" ]]; then
  echo "smoke-usage-pricing-ui: MANAGEMENT_KEY is required; set it directly or use READ_REMOTE_MANAGEMENT_KEY=1" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

echo "smoke-usage-pricing-ui: MANAGEMENT_UI_BASE=${MANAGEMENT_UI_BASE}" >&2
echo "smoke-usage-pricing-ui: MANAGEMENT_UI_ROUTE=${MANAGEMENT_UI_ROUTE}" >&2
echo "smoke-usage-pricing-ui: MANAGEMENT_KEY=<set>" >&2
echo "smoke-usage-pricing-ui: RUN_PRICING_REFRESH=${RUN_PRICING_REFRESH}" >&2
echo "smoke-usage-pricing-ui: REQUIRE_PRICING_PERSISTED_AT=${REQUIRE_PRICING_PERSISTED_AT}" >&2
echo "smoke-usage-pricing-ui: PLAYWRIGHT_IGNORE_HTTPS_ERRORS=${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-false}" >&2
echo "smoke-usage-pricing-ui: OUT_DIR=${OUT_DIR}" >&2

npx playwright install chromium >/dev/null
npx playwright test \
  "${SCRIPT_DIR}/playwright-usage-pricing-ui.smoke.spec.mjs" \
  --workers=1 \
  --reporter=line
