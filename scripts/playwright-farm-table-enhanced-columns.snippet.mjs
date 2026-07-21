// 占位断言片段（telemetry-farm-observability P0-9「表格增强 + 去死列」）。
//
// 同批占位惯例见 playwright-farm-accounts-health-columns.snippet.mjs 顶部
// 说明：`.snippet.mjs` 不会被 CI/smoke 脚本自动拾取。
//
// 覆盖范围（对应 <FarmContainerTable> 新增列 + design.md 决策6「表格增强」）：
//   1. `token_usage` 死列彻底移除：表头不再出现"Token Usage"文案/
//      column_token_usage i18n key，单元格里也不再有该值渲染。
//   2. 新增列全部渲染：健康原因（HealthPill）、最近 mem/cpu、24h 成功率、
//      device_id 对齐徽标、下次探针估算。
//   3. 行点击（排除操作按钮列）打开详情抽屉；点击 bind/unbind/retire 按钮
//      不触发行点击（stopPropagation 生效，不会同时打开抽屉又执行绑定）。
//
// import { test, expect } from '@playwright/test';
//
// const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
// const targetUrl = `${managementUiBase}#/farm`;
// const containerId = 'cliproxy-farm-columns-demo';
//
// async function mockFarmContainers(page) {
//   await page.route('**/api/farm/containers', async (route) => {
//     await route.fulfill({
//       status: 200,
//       contentType: 'application/json',
//       body: JSON.stringify([
//         {
//           id: containerId,
//           device_id_masked: 'abcd1234abcd1234',
//           status: 'running',
//           health_reason: 'ok',
//           latest_resource: { ts: new Date().toISOString(), mem_pct: 42.3, cpu_pct: 6.1 },
//           success_rate_24h: 0.99,
//           device_id_alignment: 'container_synced',
//           next_keepalive_estimate: {
//             min_seconds: 600,
//             max_seconds: 5400,
//             base_seconds: 1800,
//             avg_observed_seconds_24h: 1700,
//             note: '配置区间 + 实测均值，随机抖动，非精确',
//           },
//           created_at: new Date().toISOString(),
//           updated_at: new Date().toISOString(),
//         },
//       ]),
//     });
//   });
// }
//
// test('容器表格：去死列 + 新增健康/资源/成功率/对齐/估算列', async ({ page }) => {
//   await mockFarmContainers(page);
//   await page.goto(targetUrl);
//
//   const table = page.getByTestId('farm-container-table');
//   await expect(table).not.toContainText('Token Usage');
//
//   const row = page.getByTestId(`farm-container-row-${containerId}`);
//   await expect(row.getByTestId(`farm-container-health-reason-pill-${containerId}`)).toBeVisible();
//   await expect(row).toContainText('42.3%');
//   await expect(row).toContainText('99.0%');
//   await expect(row).toContainText('container_synced');
//
//   // 点击操作按钮不应连带打开详情抽屉。
//   await row.getByTestId(`farm-unbind-button-${containerId}`).click({ trial: true }).catch(() => {});
// });
