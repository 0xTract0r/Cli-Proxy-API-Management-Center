// 占位断言片段（telemetry-farm-observability P0-9「容器详情抽屉」）。
//
// 同批占位惯例见 playwright-farm-accounts-health-columns.snippet.mjs 顶部
// 说明：`.snippet.mjs` 不会被 CI/smoke 脚本自动拾取，接入集成门禁时把内容
// 挪进真实 spec 并接上 18417 真机非空数据（真实 GET /api/farm/containers/{id}
// 聚合详情 + .../keepalive + .../resources，不再 mock）。
//
// 覆盖范围（对应 <FarmContainerDetail> + design.md 决策6「容器详情抽屉」）：
//   1. 表格行点击 → 抽屉打开，标题带容器 id + device_id_masked。
//   2. 心跳成功率/延迟图表、资源 mem/cpu 图表各自渲染出 <svg>（不强制断言
//      像素级几何，只断言图表容器存在且非零尺寸——真实数据下再补
//      responsive-layout-review 的溢出/重叠断言）。
//   3. 下次探针估算区展示"配置区间 + 近24h实测均值"，且携带随机抖动/非精确
//      的诚实说明文案（不能是一个看起来精确的单一数字）。
//   4. 探针 token 趋势区**必须**同时出现"≠ 账单"的免责声明。
//   5. 事件时间线为空时展示"当前没有仍在 firing 的事件"，而不是空白/报错。
//   6. ESC / 点击关闭按钮可关闭抽屉，焦点归位到触发行（沿用 <Modal> 既有
//      a11y 行为，这里只做冒烟级验证不重复造 a11y 测试）。
//
// import { test, expect } from '@playwright/test';
//
// const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
// const targetUrl = `${managementUiBase}#/farm`;
// const containerId = 'cliproxy-farm-detail-demo';
//
// async function mockFarmContainerDetail(page) {
//   await page.route(`**/api/farm/containers/${containerId}`, async (route) => {
//     await route.fulfill({
//       status: 200,
//       contentType: 'application/json',
//       body: JSON.stringify({
//         id: containerId,
//         device_id_masked: 'abcd1234abcd1234',
//         status: 'running',
//         health_reason: 'ok',
//         success_rate_24h: 0.97,
//         device_id_alignment: 'container_synced',
//         next_keepalive_estimate: {
//           min_seconds: 600,
//           max_seconds: 5400,
//           base_seconds: 1800,
//           avg_observed_seconds_24h: 1620,
//           note: '基于容器侧保活脚本默认配置区间...随机抖动，非精确唤醒时间',
//         },
//         created_at: new Date().toISOString(),
//         updated_at: new Date().toISOString(),
//         open_events: [],
//       }),
//     });
//   });
//   await page.route(`**/api/farm/containers/${containerId}/keepalive*`, async (route) => {
//     await route.fulfill({
//       status: 200,
//       contentType: 'application/json',
//       body: JSON.stringify({
//         container_id: containerId,
//         since: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
//         until: new Date().toISOString(),
//         step_seconds: 3600,
//         buckets: Array.from({ length: 24 }, (_, i) => ({
//           bucket_start: new Date(Date.now() - (24 - i) * 3600 * 1000).toISOString(),
//           sample_count: 1,
//           success_count: 1,
//           success_rate: 1,
//           avg_latency_ms: 800 + i * 5,
//         })),
//       }),
//     });
//   });
//   await page.route(`**/api/farm/containers/${containerId}/resources*`, async (route) => {
//     await route.fulfill({
//       status: 200,
//       contentType: 'application/json',
//       body: JSON.stringify({
//         container_id: containerId,
//         since: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
//         until: new Date().toISOString(),
//         step_seconds: 3600,
//         buckets: Array.from({ length: 24 }, (_, i) => ({
//           bucket_start: new Date(Date.now() - (24 - i) * 3600 * 1000).toISOString(),
//           sample_count: 1,
//           avg_mem_bytes: 100_000_000 + i * 1_000_000,
//           avg_cpu_pct: 5 + i,
//         })),
//       }),
//     });
//   });
// }
//
// test('容器详情抽屉：心跳/资源图表 + 下次估算 + 探针 token 免责声明', async ({ page }) => {
//   await mockFarmContainerDetail(page);
//   await page.goto(targetUrl);
//
//   await page.getByTestId(`farm-container-row-${containerId}`).click();
//
//   const drawer = page.getByTestId(`farm-container-detail-${containerId}`);
//   await expect(drawer).toBeVisible();
//
//   await expect(page.getByTestId('farm-detail-success-rate-chart')).toBeVisible();
//   await expect(page.getByTestId('farm-detail-latency-chart')).toBeVisible();
//   await expect(page.getByTestId('farm-detail-mem-chart')).toBeVisible();
//   await expect(page.getByTestId('farm-detail-cpu-chart')).toBeVisible();
//
//   const nextEstimate = page.getByTestId('farm-detail-next-estimate');
//   await expect(nextEstimate).toContainText('配置区间');
//   await expect(nextEstimate).toContainText('实测均值');
//
//   const probeTokens = page.getByTestId('farm-detail-probe-tokens');
//   await expect(probeTokens).toContainText('≠ 账单');
//
//   await expect(page.getByTestId('farm-detail-events')).toContainText('没有仍在 firing 的事件');
//
//   await page.keyboard.press('Escape');
//   await expect(drawer).toBeHidden();
// });
