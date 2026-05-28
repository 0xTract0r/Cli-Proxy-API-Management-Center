#!/usr/bin/env bash
set -euo pipefail

# Mock 驱动的 cyber_policy 徽标 Playwright smoke。
# 不依赖真实 management key 解析 keychain，因为请求全部由 page.route 拦截。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export OUT_DIR="${OUT_DIR:-${PROJECT_DIR}/build/playwright-cyber-policy-marker}"
export MANAGEMENT_UI_BASE="${MANAGEMENT_UI_BASE:-http://10.1.1.201:18417/management.html}"
export MANAGEMENT_UI_ROUTE="${MANAGEMENT_UI_ROUTE:-#/auth-files}"
export MANAGEMENT_KEY="${MANAGEMENT_KEY:-cliproxy-201-test-management-key}"
export PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-}"

mkdir -p "${OUT_DIR}"

echo "smoke-cyber-policy-marker: MANAGEMENT_UI_BASE=${MANAGEMENT_UI_BASE}" >&2
echo "smoke-cyber-policy-marker: MANAGEMENT_UI_ROUTE=${MANAGEMENT_UI_ROUTE}" >&2
echo "smoke-cyber-policy-marker: OUT_DIR=${OUT_DIR}" >&2

npx playwright install chromium >/dev/null
npx playwright test \
  "${SCRIPT_DIR}/playwright-auth-files-cyber-policy-marker.smoke.spec.mjs" \
  --workers=1 \
  --reporter=line
