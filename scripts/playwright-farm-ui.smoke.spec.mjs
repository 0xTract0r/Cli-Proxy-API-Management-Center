import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
const managementUiRoute = process.env.MANAGEMENT_UI_ROUTE || '#/farm';
const smokeOutDir =
  process.env.OUT_DIR ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '../build/playwright-farm-smoke');
const ignoreHTTPSErrors = /^(1|true|yes|on)$/i.test(
  process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS || process.env.MANAGEMENT_UI_IGNORE_HTTPS_ERRORS || ''
);

const targetUrl = `${managementUiBase}${managementUiRoute}`;
// 农场编排器是独立后端，配置面板允许 operator 填任意 base URL；这里刻意填
// 「与页面同源」的地址，只是为了让 page.route 拦截时不触发浏览器真实 CORS
// 校验（Playwright 的 route mock 仍要过浏览器同源/CORS 检查），跟生产环境
// 编排器可以是任意跨域地址无关。
const farmOrchestratorBase = new URL(managementUiBase).origin;
const farmAdminKey = process.env.FARM_ADMIN_KEY || 'farm-smoke-admin-key';

const boundContainerId = 'cliproxy-farm-node-1';
const unboundContainerId = 'cliproxy-farm-node-2';
const testAccountName = 'smoke-account.json';

const nowIso = () => new Date().toISOString();

const fulfillJson = (route, payload, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });

function buildInitialContainers() {
  return [
    {
      id: boundContainerId,
      device_id_masked: 'aaaaaaaaaaaaaaaa...',
      status: 'running',
      token_usage: 4200,
      last_keepalive_at: nowIso(),
      created_at: nowIso(),
      updated_at: nowIso(),
      binding: {
        env: 'test',
        account: testAccountName,
        bound_at: nowIso(),
      },
    },
    {
      id: unboundContainerId,
      device_id_masked: 'bbbbbbbbbbbbbbbb...',
      status: 'created',
      token_usage: 0,
      last_keepalive_at: null,
      created_at: nowIso(),
      updated_at: nowIso(),
      binding: null,
    },
  ];
}

async function setupMockedFarmApi(page) {
  const containers = buildInitialContainers();
  let bindingCalls = 0;
  let unbindCalls = 0;

  await page.route('**/v0/management/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const respond = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
        headers: {
          'X-CPA-VERSION': 'playwright-smoke',
          'X-CPA-COMMIT': 'mock',
          'X-CPA-BUILD-DATE': new Date().toISOString(),
        },
      });
    if (pathname.endsWith('/config')) {
      return respond({
        debug: false,
        'api-keys': [],
        'proxy-url': '',
        'request-retry': 2,
        'usage-statistics-enabled': false,
        routing: { strategy: 'round-robin' },
      });
    }
    return respond({});
  });

  await page.addInitScript(() => {
    window.localStorage.setItem('apiBase', '');
    window.localStorage.setItem('managementKey', 'mock-management-key');
    window.localStorage.setItem('isLoggedIn', 'true');
  });

  await page.route('**/api/farm/containers', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await fulfillJson(route, containers);
      return;
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      const id = `cliproxy-farm-${body?.id ?? 'unknown'}`;
      const created = {
        id,
        device_id_masked: 'cccccccccccccccc...',
        status: 'created',
        token_usage: 0,
        last_keepalive_at: null,
        created_at: nowIso(),
        updated_at: nowIso(),
        binding: null,
      };
      containers.push(created);
      await fulfillJson(route, created, 201);
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/farm/accounts*', async (route) => {
    await fulfillJson(route, [
      { name: testAccountName, status: 'active', disabled: false },
    ]);
  });

  await page.route('**/api/farm/bindings', async (route) => {
    bindingCalls += 1;
    const body = route.request().postDataJSON();
    const target = containers.find((c) => c.id === body?.container_id);
    if (target) {
      target.binding = { env: body.env, account: body.account_id, bound_at: nowIso() };
    }
    await fulfillJson(
      route,
      {
        container_id: body?.container_id,
        account_id: body?.account_id,
        env: body?.env,
        bound_at: nowIso(),
        device_write: 'ok',
      },
      201
    );
  });

  await page.route('**/api/farm/bindings/*', async (route) => {
    unbindCalls += 1;
    const url = new URL(route.request().url());
    const containerId = decodeURIComponent(url.pathname.split('/').pop() || '');
    const target = containers.find((c) => c.id === containerId);
    if (target) {
      target.binding = null;
    }
    await fulfillJson(route, { device_write: 'ok', detail: '' });
  });

  return {
    getBindingCalls: () => bindingCalls,
    getUnbindCalls: () => unbindCalls,
  };
}

test.use({ ignoreHTTPSErrors });

test('farm page: configure orchestrator, render container pool, bind and unbind', async ({ page }) => {
  fs.mkdirSync(smokeOutDir, { recursive: true });
  const api = await setupMockedFarmApi(page);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  // 1) 页面加载 + 打开配置抽屉，确认配置面板存在
  await page.locator('[data-testid="farm-config-trigger"]').click();
  const configDrawer = page.locator('[data-testid="farm-config-drawer"]');
  const configPanel = configDrawer.locator('[data-testid="farm-config-panel"]');
  await expect(configPanel).toBeVisible({ timeout: 15000 });

  // 2) 未配置前，容器池区域展示配置引导，不是表格
  await expect(page.locator('[data-testid="farm-not-configured"]')).toBeVisible();

  // 3) 在配置抽屉填写编排器地址 + admin key 并保存（真实表单交互，不是 localStorage 注入）
  await configDrawer.locator('[data-testid="farm-config-base-url"]').fill(farmOrchestratorBase);
  await configDrawer.locator('[data-testid="farm-config-admin-key"]').fill(farmAdminKey);
  await configDrawer.locator('[data-testid="farm-config-save"]').click();

  // 4) 保存后应显示「已配置」，并自动拉取容器池表格（真实数据渲染断言）
  await expect(configPanel).toContainText(/已配置|Configured/i);
  await page.locator('[data-testid="farm-section-drawer-close-config"]').click();
  await page.locator('[data-testid="farm-containers-trigger"]').click();
  const containersDrawer = page.locator('[data-testid="farm-containers-drawer"]');
  const table = containersDrawer.locator('[data-testid="farm-container-table"]');
  await expect(table).toBeVisible({ timeout: 15000 });

  await containersDrawer.locator('[data-testid="farm-container-status-select"] button').click();
  await page.getByRole('option', { name: /全部|All/i }).click();

  const boundRow = containersDrawer.locator(`[data-testid="farm-container-row-${boundContainerId}"]`);
  const unboundRow = containersDrawer.locator(`[data-testid="farm-container-row-${unboundContainerId}"]`);
  await expect(boundRow).toBeVisible();
  await expect(unboundRow).toBeVisible();

  // 已绑定容器展示解绑按钮 + 绑定账号名；未绑定容器展示绑定按钮
  const unbindButton = containersDrawer.locator(
    `[data-testid="farm-unbind-button-${boundContainerId}"]`
  );
  const bindButton = containersDrawer.locator(
    `[data-testid="farm-bind-button-${unboundContainerId}"]`
  );
  await expect(unbindButton).toBeVisible();
  await expect(bindButton).toBeVisible();
  await expect(boundRow).toContainText(testAccountName);

  // 5) 绑定流程：点未绑定容器的「绑定」，弹窗应打开并可选账号提交
  await bindButton.click();
  const bindModal = page.locator('[data-testid="farm-bind-modal"]');
  await expect(bindModal).toBeVisible();

  const accountSelectTrigger = bindModal.getByRole('button', { name: /账号|Account/ }).last();
  await accountSelectTrigger.click();
  await page.getByRole('option', { name: new RegExp(testAccountName) }).click();

  const submitButton = page.locator('[data-testid="farm-bind-modal-submit"]');
  await expect(submitButton).toBeEnabled();
  await submitButton.click();

  await expect(bindModal).not.toBeVisible({ timeout: 15000 });
  await expect.poll(() => api.getBindingCalls(), { timeout: 15000 }).toBeGreaterThan(0);

  // 绑定成功后该容器应从「绑定」按钮变为「解绑」按钮（真实状态断言，非关键字数数）
  await expect(
    containersDrawer.locator(`[data-testid="farm-unbind-button-${unboundContainerId}"]`)
  ).toBeVisible({
    timeout: 15000,
  });

  // 6) 嵌套 ESC：只关闭栈顶解绑确认框，底层容器抽屉保持打开
  await unbindButton.click();
  const confirmDialog = page
    .getByRole('dialog')
    .filter({ has: page.locator('[data-testid="farm-unbind-confirm"]') });
  await expect(confirmDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirmDialog).not.toBeVisible();
  await expect(containersDrawer).toBeVisible();

  // 7) 键盘触发解绑按钮时，Enter 不得冒泡到容器行并打开详情抽屉
  await unbindButton.focus();
  await expect(unbindButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirmDialog).toBeVisible();
  await expect(page.locator('[data-testid="farm-container-detail-drawer"]')).not.toBeVisible();

  // 8) 确认解绑后，绑定状态和请求计数同步更新
  await confirmDialog.getByRole('button', { name: /确认|Confirm/ }).click();

  await expect.poll(() => api.getUnbindCalls(), { timeout: 15000 }).toBeGreaterThan(0);
  await expect(
    containersDrawer.locator(`[data-testid="farm-bind-button-${boundContainerId}"]`)
  ).toBeVisible({
    timeout: 15000,
  });

  await page.screenshot({ path: path.join(smokeOutDir, 'farm-page.png'), fullPage: true });
});
