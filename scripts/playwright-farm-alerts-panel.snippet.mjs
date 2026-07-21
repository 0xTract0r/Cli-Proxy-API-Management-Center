// 占位断言片段（telemetry-farm-observability P0-9「农场告警面板」）。
//
// 同批占位惯例见 playwright-farm-accounts-health-columns.snippet.mjs 顶部
// 说明：`.snippet.mjs` 不会被 CI/smoke 脚本自动拾取。
//
// **额外前置条件（比其它 P0-9 片段多一条）**：GET /api/farm/alerts 是 P0-5
// 交付内容，本切片实现时该后端路由尚未注册（见 useFarmAlerts.ts /
// services/api/farm.ts getAlerts 注释）。接入集成门禁前必须先确认 P0-5 已
// 合入并部署到 18417，否则真机断言会稳定收到 404 error 态（这是预期行为，
// 不是本片段的 bug）——把下面内容挪进真实 spec 前，先跑一次
// `curl {{orchestrator}}/api/farm/alerts` 确认非 404。
//
// 覆盖范围（对应 <FarmAlertsPanel> + design.md 决策4「跨容器告警 feed」）：
//   1. 默认筛选「进行中」，firing 告警用对应 severity 语义色渲染
//      （critical=err/红，warning=warn/琥珀）。
//   2. 切换到「已恢复」筛选后，resolved 告警弱化展示（data-resolved="true"）
//      且不再用 severity 色（统一 idle）。
//   3. 空态展示"暂无告警"而不是空白。
//   4. 后端 404（P0-5 未部署场景）时展示 AsyncPanel error 态，不吞错、不
//      伪造成功空列表。
//
// import { test, expect } from '@playwright/test';
//
// const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
// const targetUrl = `${managementUiBase}#/farm`;
//
// async function mockFarmAlerts(page, alerts) {
//   await page.route('**/api/farm/alerts*', async (route) => {
//     await route.fulfill({
//       status: 200,
//       contentType: 'application/json',
//       body: JSON.stringify({ alerts }),
//     });
//   });
// }
//
// test('农场告警面板：firing/resolved 两态渲染', async ({ page }) => {
//   await mockFarmAlerts(page, [
//     {
//       id: 1,
//       container_id: 'cliproxy-farm-alert-demo',
//       ts: new Date().toISOString(),
//       to_status: 'degraded',
//       reason: 'keepalive_recent_failures',
//       severity: 'warning',
//       last_seen: new Date().toISOString(),
//     },
//   ]);
//   await page.goto(targetUrl);
//
//   const panel = page.getByTestId('farm-alerts-panel');
//   await expect(panel).toBeVisible();
//   const firingItem = page.getByTestId('farm-alert-item-1');
//   await expect(firingItem).toHaveAttribute('data-resolved', 'false');
//   await expect(page.getByTestId('farm-alert-pill-1')).toHaveAttribute('data-status', 'warn');
// });
//
// test('农场告警面板：P0-5 未部署时展示 error 态而非空成功', async ({ page }) => {
//   await page.route('**/api/farm/alerts*', (route) => route.fulfill({ status: 404, body: '{"error":"not found"}' }));
//   await page.goto(targetUrl);
//   await expect(page.getByTestId('farm-alerts-error')).toBeVisible();
// });
