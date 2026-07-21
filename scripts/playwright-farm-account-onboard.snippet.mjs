// 占位断言片段（telemetry-farm-observability P0-10「前端·接入农场按钮」）。
//
// 这不是一个会被任何 smoke 脚本或 CI glob 自动拾取的可执行 spec——文件名故意
// 用 `.snippet.mjs`（不是 `*.smoke.spec.mjs`），且仓库内没有 playwright.config
// 会做目录级发现；现有 smoke 脚本（如 scripts/smoke-farm-ui.sh）都显式点名
// 目标文件，不会误跑到这个片段。落地方式对齐 P0-8 的
// `playwright-farm-accounts-health-columns.snippet.mjs` 与 P0-9 各 `.snippet.mjs`
// 惯例（page.route mock），接入 P0-集成门禁时把下面的 `test.describe` 内容挪进
// 真实 smoke spec 并接上真机数据（18417 非空真实账号，且需要 POST
// /api/farm/onboard 已由 P0-6 后端落地）即可，不需要重写断言逻辑本身。
//
// ⚠️ 依赖缺口：本片段假设的后端契约（POST /api/farm/onboard，成功态字段
// 比照 FarmBindingResponse、失败态 no_available_proxy / farm_capacity_exhausted
// 两个机器码）来自 design.md 决策5；P0-6（后端实现）在 tasks.md 仍标 `[ ]`，
// 尚未接通 201 真机。真机门禁前必须先确认 P0-6 完成且实际响应体/错误码与本
// 片段假设一致，不一致要回来同步调整断言，不能假装已经端到端验证过。
//
// 覆盖范围（对应本次实现 + design.md 决策5 Scenario「半自动 onboard」）：
//   1. 「已认证未接入」账号（farm_bound=false 且 disabled=false）在容器健康
//      列内渲染「接入农场」按钮（data-testid=farm-account-onboard-<name>）；
//      已接入（farm_bound=true）与已禁用（disabled=true）账号都不渲染该按钮。
//   2. 点击按钮 → 按钮进入 loading 态（Button `loading` 会 disable 自身并展示
//      spinner），期间不可重复点击触发第二次请求。
//   3a. 成功链路：mock 200 → toast 显示成功通知（farm.notification.onboardSuccess）
//      → 账号列表 reload（mock 第二次 GET /api/farm/accounts 返回 farm_bound=true，
//      断言按钮消失、容器健康列改渲染真实 HealthPill）。
//   3b. 失败链路（no_available_proxy）：mock 4xx { error: "no_available_proxy" }
//      → toast 显示可读提示（"该环境无可用住宅代理,先配代理" 对应中文文案）
//      而非原始错误码本身；按钮 loading 态清除、按钮本身仍可再次点击（不因
//      失败被永久禁用）。
//   3c. 失败链路（farm_capacity_exhausted）：同 3b，断言文案为"容器池已满"。
//
// import { test, expect } from '@playwright/test';
//
// const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
// const targetUrl = `${managementUiBase}#/farm`;
//
// const unboundAccount = 'farm-onboard-unbound.json';
// const boundAccount = 'farm-onboard-bound.json';
// const disabledAccount = 'farm-onboard-disabled.json';
//
// async function mockFarmAccountsList(page, { unboundAlreadyBound = false } = {}) {
//   await page.route('**/api/farm/accounts*', async (route) => {
//     await route.fulfill({
//       status: 200,
//       contentType: 'application/json',
//       body: JSON.stringify([
//         unboundAlreadyBound
//           ? {
//               name: unboundAccount,
//               status: 'active',
//               disabled: false,
//               farm_bound: true,
//               farm_container_id: 'cliproxy-farm-onboard-1',
//               farm_env: 'test',
//               farm_container_status: 'running',
//               device_id_source: 'container_synced',
//             }
//           : {
//               name: unboundAccount,
//               status: 'active',
//               disabled: false,
//               farm_bound: false,
//               device_id_source: 'synthetic',
//             },
//         {
//           name: boundAccount,
//           status: 'active',
//           disabled: false,
//           farm_bound: true,
//           farm_container_id: 'cliproxy-farm-onboard-2',
//           farm_env: 'test',
//           farm_container_status: 'running',
//           device_id_source: 'container_synced',
//         },
//         {
//           name: disabledAccount,
//           status: 'active',
//           disabled: true,
//           farm_bound: false,
//           device_id_source: 'synthetic',
//         },
//       ]),
//     });
//   });
// }
//
// test.describe('农场账号面板：接入农场按钮（P0-10）', () => {
//   test('未接入账号显示按钮；已接入/已禁用账号不显示', async ({ page }) => {
//     await mockFarmAccountsList(page);
//     await page.goto(targetUrl);
//
//     await expect(page.getByTestId(`farm-account-onboard-${unboundAccount}`)).toBeVisible();
//     await expect(page.getByTestId(`farm-account-onboard-${boundAccount}`)).toHaveCount(0);
//     await expect(page.getByTestId(`farm-account-onboard-${disabledAccount}`)).toHaveCount(0);
//   });
//
//   test('点击接入后进入 loading 态，成功后 toast + reload 清掉按钮', async ({ page }) => {
//     await mockFarmAccountsList(page);
//     let onboardCalled = 0;
//     await page.route('**/api/farm/onboard', async (route) => {
//       onboardCalled += 1;
//       // mock 网络延迟，给测试留窗口断言 loading 态
//       await new Promise((resolve) => setTimeout(resolve, 300));
//       await route.fulfill({
//         status: 200,
//         contentType: 'application/json',
//         body: JSON.stringify({
//           container_id: 'cliproxy-farm-onboard-1',
//           account_id: unboundAccount,
//           env: 'test',
//           bound_at: new Date().toISOString(),
//           device_write: 'ok',
//         }),
//       });
//     });
//     await page.goto(targetUrl);
//
//     const onboardButton = page.getByTestId(`farm-account-onboard-${unboundAccount}`);
//     await onboardButton.click();
//     await expect(onboardButton).toBeDisabled();
//
//     // 成功后 reload 会重新拉取账号列表；把 mock 切成已绑定态验证按钮消失。
//     await mockFarmAccountsList(page, { unboundAlreadyBound: true });
//     await expect(page.getByText(/onboarded to farm|已接入农场/i)).toBeVisible();
//     await expect(page.getByTestId(`farm-account-onboard-${unboundAccount}`)).toHaveCount(0, {
//       timeout: 5000,
//     });
//     expect(onboardCalled).toBe(1);
//   });
//
//   test('no_available_proxy 失败态：呈现可读提示，按钮恢复可点击', async ({ page }) => {
//     await mockFarmAccountsList(page);
//     await page.route('**/api/farm/onboard', async (route) => {
//       await route.fulfill({
//         status: 409,
//         contentType: 'application/json',
//         body: JSON.stringify({ error: 'no_available_proxy' }),
//       });
//     });
//     await page.goto(targetUrl);
//
//     const onboardButton = page.getByTestId(`farm-account-onboard-${unboundAccount}`);
//     await onboardButton.click();
//     await expect(page.getByText(/no residential proxy|无可用住宅代理/i)).toBeVisible();
//     // 失败不应把按钮永久禁用（区别于成功后按钮从 DOM 消失）。
//     await expect(onboardButton).toBeEnabled();
//   });
//
//   test('farm_capacity_exhausted 失败态：呈现"容器池已满"提示', async ({ page }) => {
//     await mockFarmAccountsList(page);
//     await page.route('**/api/farm/onboard', async (route) => {
//       await route.fulfill({
//         status: 409,
//         contentType: 'application/json',
//         body: JSON.stringify({ error: 'farm_capacity_exhausted' }),
//       });
//     });
//     await page.goto(targetUrl);
//
//     const onboardButton = page.getByTestId(`farm-account-onboard-${unboundAccount}`);
//     await onboardButton.click();
//     await expect(page.getByText(/container pool is full|容器池已满/i)).toBeVisible();
//     await expect(onboardButton).toBeEnabled();
//   });
// });
