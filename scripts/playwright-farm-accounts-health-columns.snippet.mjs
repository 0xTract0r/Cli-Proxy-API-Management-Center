// 占位断言片段（telemetry-farm-observability P0-8「前端状态栏双列」）。
//
// 这不是一个会被任何 smoke 脚本或 CI glob 自动拾取的可执行 spec——文件名故意
// 用 `.snippet.mjs`（不是 `*.smoke.spec.mjs`），且仓库内没有 playwright.config
// 会做目录级发现；现有 smoke 脚本（如 scripts/smoke-farm-ui.sh）都显式点名
// 目标文件，不会误跑到这个片段。落地方式对齐现有
// `playwright-farm-ui.smoke.spec.mjs` 的 page.route mock 惯例，接入 P0-8/P0-9
// 集成门禁时把下面的 `test.describe` 内容挪进真实 smoke spec 并接上真机数据
// （18417 非空真实账号/容器）即可，不需要重写断言逻辑本身。
//
// 覆盖范围（对应本次实现 + spec Scenario「状态双列」）：
//   1. 「账号健康」与「容器健康」两列在 DOM 中独立存在（不同 data-testid，
//      不再挤同一个 <TableCell>）。
//   2. running 容器 → 「容器健康」列 HealthPill 语义色为 ok（绿色 token），
//      data-status="ok"，而不是复用旧的 success/error/muted 徽标 className。
//   3. disabled 账号 → 账号名旁渲染中性 tag（status-badge muted），不落在
//      「账号健康」列内、且不带 err/warn 语义色（不与故障争视觉权重）。
//
// import { test, expect } from '@playwright/test';
//
// const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
// const targetUrl = `${managementUiBase}#/farm`;
//
// const boundRunningAccount = 'farm-health-running.json';
// const disabledAccount = 'farm-health-disabled.json';
//
// async function mockFarmAccounts(page) {
//   await page.route('**/api/farm/accounts*', async (route) => {
//     await route.fulfill({
//       status: 200,
//       contentType: 'application/json',
//       body: JSON.stringify([
//         {
//           name: boundRunningAccount,
//           status: 'active',
//           disabled: false,
//           farm_bound: true,
//           farm_container_id: 'cliproxy-farm-health-1',
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
// test('农场账号面板：状态栏双列（账号健康 / 容器健康）', async ({ page }) => {
//   await mockFarmAccounts(page);
//   await page.goto(targetUrl);
//
//   // 1) 两列独立存在：同一行内账号健康格与容器健康格是两个不同 testid 的
//   //    <TableCell>，而不是共享一格挤徽标。
//   const accountHealthCell = page.getByTestId(`farm-account-health-cell-${boundRunningAccount}`);
//   const containerHealthCell = page.getByTestId(`farm-container-health-cell-${boundRunningAccount}`);
//   await expect(accountHealthCell).toBeVisible();
//   await expect(containerHealthCell).toBeVisible();
//   await expect(accountHealthCell).not.toContainText(await containerHealthCell.innerText());
//
//   // 2) running 容器 → 容器健康列 HealthPill 语义色 ok（绿色 token），
//   //    data-status 直接断言而非只读文案，避免只验文字漏掉配色回归。
//   const containerPill = containerHealthCell.getByTestId(
//     `farm-container-health-pill-${boundRunningAccount}`
//   );
//   await expect(containerPill).toHaveAttribute('data-status', 'ok');
//
//   // 3) disabled 账号 → 账号名旁中性 tag，不在健康列内、不是故障色。
//   const disabledTag = page.getByTestId(`farm-account-disabled-tag-${disabledAccount}`);
//   await expect(disabledTag).toBeVisible();
//   await expect(disabledTag).toHaveClass(/muted/);
//   await expect(disabledTag).not.toHaveClass(/(error|warning)/);
//   // disabled tag 必须落在姓名格，不落进健康列（health cell 不应包含它）。
//   const disabledAccountHealthCell = page.getByTestId(`farm-account-health-cell-${disabledAccount}`);
//   await expect(disabledAccountHealthCell.getByTestId(`farm-account-disabled-tag-${disabledAccount}`)).toHaveCount(
//     0
//   );
// });
