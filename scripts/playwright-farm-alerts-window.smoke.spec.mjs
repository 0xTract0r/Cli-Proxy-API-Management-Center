// 回归测试（telemetry-farm-ux-hardening 部署后真机门禁抓到的真 bug）：
//
// <FarmAlertsPanel> 曾对 summary 和 full-drawer 两种 mode 都硬编码
// `useFarmAlerts({ status: effectiveFilter, window: '24h' })`。firing 语义是
// "当前仍未解决"，不该按告警触发时间的年龄过滤——真实故障复现：两个容器
// 2026-07-26 触发 down/未恢复告警，首屏 KPI「活跃告警」（GET /api/farm/overview
// 的 active_alerts，见 dto.go 注释，同样不限年龄）显示 2，但告警摘要面板 +
// "查看全部"抽屉因为硬编码 window=24h 都显示"暂无告警"——数字互相矛盾。
//
// 后端 GET /api/farm/alerts 不传 window 时的契约明确是"不限时间窗，返回全部
// 历史"（services/farm-orchestrator/internal/httpapi/observability.go
// handleGetAlerts 顶部注释），配合 status=firing 即为"当前全部未解决"。本测试
// 断言：firing 请求不再带 window 参数；resolved 视图仍保留 window=24h（未改
// 动的路径不应连带回归）。
import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
const managementUiRoute = process.env.MANAGEMENT_UI_ROUTE || '#/farm';
const targetUrl = `${managementUiBase}${managementUiRoute}`;
const smokeOutDir =
  process.env.OUT_DIR ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '../build/playwright-farm-smoke');
const farmOrchestratorBase = new URL(managementUiBase).origin;
const farmAdminKey = process.env.FARM_ADMIN_KEY || 'farm-smoke-admin-key';
const ignoreHTTPSErrors = /^(1|true|yes|on)$/i.test(
  process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS || process.env.MANAGEMENT_UI_IGNORE_HTTPS_ERRORS || ''
);

const boundContainerId = 'cliproxy-farm-node-1';
const nowIso = () => new Date().toISOString();
const hoursAgoIso = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();

// 两条 firing 告警，触发时间在 48/50 小时前，至今仍未解决（无 resolved_at）——
// 刻意超过旧代码硬编码的 24h window，用来复现「被静默过滤掉」的真实故障。
const staleFiringAlerts = [
  {
    id: 101,
    container_id: boundContainerId,
    ts: hoursAgoIso(48),
    to_status: 'down',
    reason: 'container_exited',
    severity: 'critical',
    last_seen: hoursAgoIso(1),
  },
  {
    id: 102,
    container_id: boundContainerId,
    ts: hoursAgoIso(50),
    to_status: 'down',
    reason: 'keepalive_stale',
    severity: 'critical',
    last_seen: hoursAgoIso(1),
  },
];

const resolvedAlert = {
  id: 201,
  container_id: boundContainerId,
  ts: hoursAgoIso(2),
  from_status: 'degraded',
  to_status: 'running',
  reason: 'keepalive_recovered',
  severity: 'warning',
  last_seen: hoursAgoIso(1),
  resolved_at: hoursAgoIso(1),
};

const fulfillJson = (route, payload, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });

async function setupMockedFarmApi(page, alertRequests) {
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

  await page.route('**/api/farm/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === '/api/farm/containers' && request.method() === 'GET') {
      await fulfillJson(route, []);
      return;
    }
    if (pathname === '/api/farm/overview') {
      await fulfillJson(route, {
        containers_by_status: { running: 0, degraded: 0, down: 1, created: 0 },
        total_containers: 1,
        // 与两条 mock firing 告警数量对齐：首屏 KPI 和告警摘要必须显示一致的数字。
        active_alerts: staleFiringAlerts.length,
        device_id_drift_unresolved: 0,
        stale_keepalive_count: 0,
        generated_at: nowIso(),
      });
      return;
    }
    if (pathname === '/api/farm/alerts') {
      const status = url.searchParams.get('status');
      alertRequests.push({ status, hasWindow: url.searchParams.has('window'), search: url.search });
      if (status === 'resolved') {
        await fulfillJson(route, { alerts: [resolvedAlert] });
        return;
      }
      // firing（默认）/ all：不按年龄过滤，两条 stale 告警原样返回。
      await fulfillJson(route, { alerts: staleFiringAlerts });
      return;
    }
    await fulfillJson(route, {});
  });
}

async function configureFarm(page) {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="farm-not-configured"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="farm-config-empty-cta"]').click();
  await expect(page.locator('[data-testid="farm-config-panel"]')).toBeVisible();
  await page.locator('[data-testid="farm-config-base-url"]').fill(farmOrchestratorBase);
  await page.locator('[data-testid="farm-config-admin-key"]').fill(farmAdminKey);
  await page.locator('[data-testid="farm-config-save"]').click();
  await expect(page.locator('[data-testid="farm-first-screen"]')).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Escape');
}

test.use({ ignoreHTTPSErrors });

test('farm alerts: firing summary/drawer surfaces alerts older than 24h and matches the KPI count', async ({
  page,
}) => {
  fs.mkdirSync(smokeOutDir, { recursive: true });
  const alertRequests = [];
  await setupMockedFarmApi(page, alertRequests);
  await configureFarm(page);

  // 1) 首屏 KPI「活跃告警」应等于 mock 的 2 条未解决告警。
  await expect(page.getByTestId('farm-overview-kpi-alerts')).toContainText(String(staleFiringAlerts.length));

  // 2) summary 面板（mode="summary"，effectiveFilter 固定 firing）不能因为
  // 告警触发时间 >24h 前就把它们过滤成空态——这正是真实故障复现的界面。
  const summaryPanel = page.getByTestId('farm-alert-summary');
  await expect(summaryPanel).toBeVisible();
  await expect(summaryPanel.getByTestId('farm-alerts-empty')).toHaveCount(0);
  for (const alert of staleFiringAlerts) {
    await expect(page.getByTestId(`farm-alert-summary-item-${alert.id}`)).toBeVisible();
  }

  // 3) "查看全部"抽屉（mode="full"，默认筛选同样是 firing）同样应该看到全部
  // 2 条未解决告警，不是"无告警"。
  await page.getByTestId('farm-alerts-view-all').click();
  const drawer = page.getByTestId('farm-alerts-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('farm-alerts-empty')).toHaveCount(0);
  for (const alert of staleFiringAlerts) {
    await expect(page.getByTestId(`farm-alert-item-${alert.id}`)).toBeVisible();
  }

  await page.screenshot({
    path: path.join(smokeOutDir, 'farm-alerts-window-regression.png'),
    fullPage: false,
  });

  // 4) 切到「已恢复」筛选：resolved 视图仍应保留 window（本次修复只动 firing
  // 路径，验证没有连带破坏「已恢复」原有的近期收窄行为）。
  await drawer.getByTestId('farm-alerts-filter').locator('button').click();
  await page.getByRole('option', { name: /已恢复|Resolved/i }).click();
  await expect(page.getByTestId(`farm-alert-item-${resolvedAlert.id}`)).toBeVisible();

  // 5) 核心回归断言：firing 请求不能带 window 参数；resolved 请求必须带
  // window 参数。
  const firingRequests = alertRequests.filter((r) => r.status === 'firing');
  const resolvedRequests = alertRequests.filter((r) => r.status === 'resolved');
  expect(firingRequests.length, 'expected at least one firing alerts request').toBeGreaterThan(0);
  for (const r of firingRequests) {
    expect(r.hasWindow, `firing alerts request must not include window param (search=${r.search})`).toBe(
      false
    );
  }
  expect(resolvedRequests.length, 'expected at least one resolved alerts request').toBeGreaterThan(0);
  for (const r of resolvedRequests) {
    expect(
      r.hasWindow,
      `resolved alerts request should still include window param (search=${r.search})`
    ).toBe(true);
  }
});
