#!/usr/bin/env bash
# 确定性回归：认证文件页「测试发送消息」打坏号(401)不应登出整个前端。
# 全程 mock，不依赖真实后端：构建 dist/ 单文件 -> 本地静态服务 -> Playwright 路由拦截。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export OUT_DIR="${OUT_DIR:-${PROJECT_DIR}/build/playwright-test-message-logout}"
PORT="${MOCK_UI_PORT:-4319}"
export MOCK_UI_BASE_URL="${MOCK_UI_BASE_URL:-http://127.0.0.1:${PORT}}"

mkdir -p "${OUT_DIR}"

# 始终重新构建，确保测试跑的是当前源码而非陈旧 dist（陈旧 dist 会给出误导性结果）。
# 若只想复用已有构建，显式设置 SKIP_BUILD=1。
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "smoke-test-message-logout: building dist/ from current source..." >&2
  (cd "${PROJECT_DIR}" && npm run build)
elif [[ ! -f "${PROJECT_DIR}/dist/index.html" ]]; then
  echo "smoke-test-message-logout: SKIP_BUILD=1 but dist/index.html missing, building anyway..." >&2
  (cd "${PROJECT_DIR}" && npm run build)
fi

# 启动一个极简 Node 静态服务器服务 dist/。
SERVER_PID=""
cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "smoke-test-message-logout: serving dist/ at ${MOCK_UI_BASE_URL}" >&2
DIST_DIR="${PROJECT_DIR}/dist" PORT="${PORT}" node "${SCRIPT_DIR}/static-serve.mjs" &
SERVER_PID=$!

# 等待服务器就绪。
for _ in $(seq 1 50); do
  if curl -sf "${MOCK_UI_BASE_URL}/index.html" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

npx playwright install chromium >/dev/null 2>&1 || true
npx playwright test \
  "${SCRIPT_DIR}/playwright-auth-files-test-message-logout.spec.mjs" \
  --workers=1 \
  --reporter=line
