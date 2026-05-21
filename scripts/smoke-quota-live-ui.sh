#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export OUT_DIR="${OUT_DIR:-${PROJECT_DIR}/build/playwright-quota-live-smoke}"
export MANAGEMENT_UI_ROUTE="${MANAGEMENT_UI_ROUTE:-#/quota}"
export PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-${MANAGEMENT_UI_IGNORE_HTTPS_ERRORS:-}}"
export LIVE_QUOTA_TRIGGER_REFRESH="${LIVE_QUOTA_TRIGGER_REFRESH:-1}"
export LIVE_QUOTA_MAX_OK_AGE_HOURS="${LIVE_QUOTA_MAX_OK_AGE_HOURS:-24}"
export LIVE_QUOTA_SUPPORTED_PROVIDERS="${LIVE_QUOTA_SUPPORTED_PROVIDERS:-codex,claude}"

quota_refresh_enabled() {
  case "${LIVE_QUOTA_TRIGGER_REFRESH}" in
    0|false|FALSE|False|no|NO|No|off|OFF|Off) return 1 ;;
    *) return 0 ;;
  esac
}

if [[ -z "${MANAGEMENT_UI_BASE:-}" ]]; then
  echo "smoke-quota-live-ui: MANAGEMENT_UI_BASE is required, for example http://10.1.1.201:18417/management.html" >&2
  exit 1
fi

if [[ "${MANAGEMENT_UI_BASE}" == *":18317"* && "${ALLOW_PRODUCTION_UI_SMOKE:-0}" != "1" ]]; then
  echo "smoke-quota-live-ui: refusing to run against production-looking :18317 target without ALLOW_PRODUCTION_UI_SMOKE=1" >&2
  exit 1
fi

if [[ "${MANAGEMENT_UI_BASE}" == *":18317"* ]] && quota_refresh_enabled && [[ "${ALLOW_PRODUCTION_QUOTA_REFRESH:-0}" != "1" ]]; then
  echo "smoke-quota-live-ui: refusing to refresh production-looking :18317 target; set LIVE_QUOTA_TRIGGER_REFRESH=0 for read-only smoke" >&2
  exit 1
fi

if [[ -z "${MANAGEMENT_KEY:-}" && "${READ_REMOTE_MANAGEMENT_KEY:-0}" == "1" ]]; then
  REMOTE_HOST="${REMOTE_HOST:-wisedata@10.1.1.201}"
  DEPLOY_DIR="${DEPLOY_DIR:-/home/wisedata/deploy/cliproxyapi-plus-oauth-test}"
  REMOTE_MANAGEMENT_SECRET_FILE="${REMOTE_MANAGEMENT_SECRET_FILE:-${DEPLOY_DIR}/runtime/secrets.env}"
  MANAGEMENT_KEY="$(ssh "${REMOTE_HOST}" "set -euo pipefail; set -a; . '${REMOTE_MANAGEMENT_SECRET_FILE}'; set +a; printf '%s' \"\${MANAGEMENT_PASSWORD:-}\"")"
  export MANAGEMENT_KEY
fi

if [[ -z "${MANAGEMENT_KEY:-}" ]]; then
  echo "smoke-quota-live-ui: MANAGEMENT_KEY is required; set it directly or use READ_REMOTE_MANAGEMENT_KEY=1 for a test deploy" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

echo "smoke-quota-live-ui: MANAGEMENT_UI_BASE=${MANAGEMENT_UI_BASE}" >&2
echo "smoke-quota-live-ui: MANAGEMENT_UI_ROUTE=${MANAGEMENT_UI_ROUTE}" >&2
echo "smoke-quota-live-ui: MANAGEMENT_KEY=<set>" >&2
echo "smoke-quota-live-ui: LIVE_QUOTA_TRIGGER_REFRESH=${LIVE_QUOTA_TRIGGER_REFRESH}" >&2
echo "smoke-quota-live-ui: LIVE_QUOTA_MAX_OK_AGE_HOURS=${LIVE_QUOTA_MAX_OK_AGE_HOURS}" >&2
echo "smoke-quota-live-ui: LIVE_QUOTA_SUPPORTED_PROVIDERS=${LIVE_QUOTA_SUPPORTED_PROVIDERS}" >&2
if [[ -n "${LIVE_QUOTA_REQUIRE_POLICY:-}" ]]; then
  echo "smoke-quota-live-ui: LIVE_QUOTA_REQUIRE_POLICY=${LIVE_QUOTA_REQUIRE_POLICY}" >&2
fi
echo "smoke-quota-live-ui: PLAYWRIGHT_IGNORE_HTTPS_ERRORS=${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-false}" >&2
echo "smoke-quota-live-ui: OUT_DIR=${OUT_DIR}" >&2

npx playwright install chromium >/dev/null
npx playwright test \
  "${SCRIPT_DIR}/playwright-quota-live-ui.smoke.spec.mjs" \
  --workers=1 \
  --reporter=line
