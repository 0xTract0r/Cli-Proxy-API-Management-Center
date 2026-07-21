// 占位断言片段（telemetry-farm-observability P0-9「前端概览带」）。
//
// 同 playwright-farm-accounts-health-columns.snippet.mjs 的占位惯例：文件名
// 用 `.snippet.mjs`（不是 `*.smoke.spec.mjs`），不会被任何 CI glob / smoke
// 脚本自动拾取。接入 P0-9 集成门禁时把下面内容挪进真实 smoke spec，接上真机
// 18417 非空数据（真实 GET /api/farm/overview 响应，不再 mock）即可。
//
// 覆盖范围（对应 <FarmOverviewBar> + spec Scenario「状态双列」相邻的概览带
// 验收点）：
//   1. 6 个 KPI tile 全部渲染（运行/降级/离线容器、活跃告警、绑定账号、
//      探针 cost），data-testid 逐个可定位。
//   2. 占位 KPI（探针 cost，本轮后端恒 undefined）展示"—/待P1"文案，不是
//      "0"——防止把"没测出来"误渲染成"确认为 0"的回归。
//   3. "数据截至"时间戳存在且非空，附带诚实说明（非精确 Poller 时刻）。
//
// import { test, expect } from '@playwright/test';
//
// const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
// const targetUrl = `${managementUiBase}#/farm`;
//
// async function mockFarmOverview(page) {
//   await page.route('**/api/farm/overview', async (route) => {
//     await route.fulfill({
//       status: 200,
//       contentType: 'application/json',
//       body: JSON.stringify({
//         containers_by_status: { running: 3, degraded: 1, down: 0, created: 1 },
//         total_containers: 5,
//         active_alerts: 1,
//         device_id_drift_unresolved: 0,
//         // probe_token_cost_total_24h 故意不带字段（后端 omitempty + nil），
//         // 断言 UI 必须显示占位文案而不是把 undefined 当 0 处理。
//         stale_keepalive_count: 1,
//         generated_at: new Date().toISOString(),
//       }),
//     });
//   });
// }
//
// test('农场概览带：KPI 全量渲染 + 占位 KPI 诚实展示', async ({ page }) => {
//   await mockFarmOverview(page);
//   await page.goto(targetUrl);
//
//   const bar = page.getByTestId('farm-overview-bar');
//   await expect(bar).toBeVisible();
//
//   await expect(page.getByTestId('farm-overview-kpi-running')).toContainText('3');
//   await expect(page.getByTestId('farm-overview-kpi-degraded')).toContainText('1');
//   await expect(page.getByTestId('farm-overview-kpi-down')).toContainText('0');
//   await expect(page.getByTestId('farm-overview-kpi-alerts')).toContainText('1');
//   // 绑定账号数不来自 /overview，来自容器列表 binding 字段本地统计——断言时
//   // 需要同时 mock /api/farm/containers 并按绑定条数核对，此处只示意占位。
//   await expect(page.getByTestId('farm-overview-kpi-bound')).toBeVisible();
//
//   const probeCost = page.getByTestId('farm-overview-kpi-probe-cost');
//   await expect(probeCost).toContainText('待P1');
//   await expect(probeCost).not.toContainText(/(^|[^0-9])0([^0-9]|$)/);
//
//   await expect(page.getByTestId('farm-overview-generated-at')).toBeVisible();
// });
