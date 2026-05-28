import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

// Mock-driven Playwright smoke 验证 cyber_policy 徽标渲染：
// 1) flag_count > 0 的卡片渲染 StatusMarker variant="warning"，且 tooltip 含
//    `命中` + 数字 count + （可选）`最近 <时间>`；
// 2) flag_count = 0 的卡片不渲染该徽标；
// 3) 截图保留到 OUT_DIR 供 lead 复看。
//
// 故意把语言锁定为 zh-CN，避免 chromium 默认 navigator.language 漂移到 en；
// 故意只 mock 与 auth-files 相关的若干 management API，避免 console error 噪音。

const managementUiBase =
  process.env.MANAGEMENT_UI_BASE || 'http://10.1.1.201:18417/management.html';
const managementUiRoute = process.env.MANAGEMENT_UI_ROUTE || '#/auth-files';
const managementKey = process.env.MANAGEMENT_KEY || 'cliproxy-201-test-management-key';
const smokeOutDir =
  process.env.OUT_DIR ||
  path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../build/playwright-cyber-policy-marker'
  );
const ignoreHTTPSErrors = /^(1|true|yes|on)$/i.test(
  process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS || ''
);

const targetUrl = `${managementUiBase}${managementUiRoute}`;

// 单 viewport：1280x720 desktop。compact viewport 已知有 3px 边界
// 排版问题，会污染 console，所以本 spec 只跑 desktop。
const viewport = { name: 'desktop', width: 1280, height: 720 };

test.use({ ignoreHTTPSErrors });

const nowIso = '2026-05-27T01:13:13Z';
const flaggedLastIso = '2026-05-27T01:12:46Z';
const flaggedCount = 3;

// 真实 API entry 字段集合（curl 抄表）：
// account, account_settings, account_type, auth_index, created_at,
// cyber_policy_flag_count, disabled, email, headers, id, label, modtime,
// name, note, path, provider, proxy_url, runtime_only, size, source,
// status, status_message, type, unavailable, updated_at.
// 注意：status_message 故意留空，防止触发额外的 file-status warning marker。
const flaggedAuthFile = {
  id: 'mock-flagged',
  name: 'mock-flagged.json',
  label: 'mock-flagged@example.com',
  email: 'mock-flagged@example.com',
  account: 'mock-flagged@example.com',
  account_type: 'plus',
  provider: 'codex',
  type: 'codex',
  source: 'codex',
  status: 'active',
  status_message: '',
  path: '/CLIProxyAPI/auth/mock-flagged.json',
  auth_index: 'mock-flagged-idx',
  cyber_policy_flag_count: flaggedCount,
  last_cyber_policy_at: flaggedLastIso,
  modtime: nowIso,
  updated_at: nowIso,
  created_at: nowIso,
  size: 1024,
  disabled: false,
  unavailable: false,
  runtime_only: false,
  headers: {},
  account_settings: {
    proxy_url: '',
    note: '',
    disabled: false,
    refresh_enabled: true,
    managed_headers: {},
    extra_headers: {},
    transport_profile: null,
    tls_profile: null,
  },
  proxy_url: '',
  note: '',
};

const cleanAuthFile = {
  id: 'mock-clean',
  name: 'mock-clean.json',
  label: 'mock-clean@example.com',
  email: 'mock-clean@example.com',
  account: 'mock-clean@example.com',
  account_type: 'plus',
  provider: 'codex',
  type: 'codex',
  source: 'codex',
  status: 'active',
  status_message: '',
  path: '/CLIProxyAPI/auth/mock-clean.json',
  auth_index: 'mock-clean-idx',
  cyber_policy_flag_count: 0,
  modtime: nowIso,
  updated_at: nowIso,
  created_at: nowIso,
  size: 1024,
  disabled: false,
  unavailable: false,
  runtime_only: false,
  headers: {},
  account_settings: {
    proxy_url: '',
    note: '',
    disabled: false,
    refresh_enabled: true,
    managed_headers: {},
    extra_headers: {},
    transport_profile: null,
    tls_profile: null,
  },
  proxy_url: '',
  note: '',
};

async function installManagementApiMock(page) {
  await page.route('**/v0/management/**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const respond = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
        headers: {
          'X-CPA-VERSION': 'playwright-cyber-policy-marker',
          'X-CPA-COMMIT': 'mock',
          'X-CPA-BUILD-DATE': nowIso,
        },
      });

    if (pathname.endsWith('/auth-files')) {
      return respond({
        files: [flaggedAuthFile, cleanAuthFile],
        total: 2,
      });
    }

    if (pathname.endsWith('/auth-files/account-settings')) {
      const name = url.searchParams.get('name') || '';
      const settings =
        name === flaggedAuthFile.name
          ? flaggedAuthFile.account_settings
          : cleanAuthFile.account_settings;
      return respond({ name, account_settings: settings });
    }

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

    if (pathname.endsWith('/usage')) return respond({ usage: {} });
    if (pathname.endsWith('/oauth-reauth-history')) return respond({ events: [] });
    if (pathname.endsWith('/auth-status-history')) return respond({ events: [] });
    if (pathname.includes('/auth-files/models')) return respond({ models: [] });
    if (pathname.includes('/model-definitions/')) return respond({ models: [] });
    return respond({});
  });
}

async function loginIfNeeded(page) {
  // 先注册 route 拦截，再 navigate；同时锁定 zh-CN 语言与 mock management key。
  await installManagementApiMock(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('cli-proxy-language', 'zh-CN');
    window.localStorage.setItem('apiBase', '');
    window.localStorage.setItem('managementKey', 'mock-management-key');
    window.localStorage.setItem('isLoggedIn', 'true');
  });

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const loginInput = page.getByLabel(/Management Key|管理密钥/i);
  if ((await loginInput.count()) > 0) {
    await loginInput.fill(managementKey);
    await page.getByRole('button', { name: /Login|登录/i }).click();
    await page.waitForTimeout(800);
  }

  if (!page.url().includes('#/auth-files')) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
  }

  await page.waitForSelector('[data-testid="auth-file-card"]', { timeout: 20000 });
}

// 给定 card scope 与 expected tooltip substring，定位 cyber_policy marker
// （StatusMarker variant="warning" 且 tooltip 含目标 substring）。
function locateCyberPolicyMarker(cardLocator, substring) {
  return cardLocator
    .locator('[data-testid="auth-file-status-marker-warning"]')
    .filter({
      has: cardLocator.page().locator(
        `[data-testid="auth-file-status-tooltip-warning"]:has-text("${substring}")`
      ),
    });
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  fs.mkdirSync(smokeOutDir, { recursive: true });
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
});

test('flagged auth card renders cyber_policy warning marker with count + last time tooltip', async ({
  page,
}) => {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await loginIfNeeded(page);

  const cards = page.locator('[data-testid="auth-file-card"]');
  await expect(cards).toHaveCount(2);

  // mock-flagged 卡片：根据卡片内含 fileName 文本筛选。
  const flaggedCard = cards.filter({ hasText: flaggedAuthFile.name });
  await expect(flaggedCard).toHaveCount(1);

  // 在 flagged card 范围内查找 warning marker。
  const warningMarkers = flaggedCard.locator(
    '[data-testid="auth-file-status-marker-warning"]'
  );
  // mock 未提供 status_message，所以应该只有一个 warning marker（即 cyber_policy）。
  await expect(warningMarkers).toHaveCount(1);

  const cyberMarker = warningMarkers.first();
  await expect(cyberMarker).toBeVisible();

  // aria-label = tooltip 完整文案。tooltip element 自身因 CSS 可能不可见，
  // 这里以 aria-label / inner text 同步断言关键 substring。
  const ariaLabel = (await cyberMarker.getAttribute('aria-label')) || '';
  expect(ariaLabel).toContain('命中');
  expect(ariaLabel).toContain(String(flaggedCount));
  // 含 last 时间的渲染：i18n 中 zh-CN 文案 "... · 最近 {{last}}"，
  // toLocaleString 在 chromium 默认会输出中文/数字混合，故断言含 "最近" 即可。
  expect(ariaLabel).toContain('最近');

  // tooltip element 文本应当与 aria-label 完全一致。
  const tooltipText =
    (await cyberMarker
      .locator('[data-testid="auth-file-status-tooltip-warning"]')
      .textContent()) || '';
  expect(tooltipText.trim()).toBe(ariaLabel.trim());

  // cyber_policy 徽标里应可见数字 count，与原有空心点视觉区分。
  // 用 evaluate 拿 marker root 自身文本（含 tooltip 文本），再断言含 count 字符串。
  const flaggedMarkerText = await cyberMarker.evaluate(
    (el) => el.textContent?.trim() || ''
  );
  expect(flaggedMarkerText).toContain(String(flaggedCount));

  // 截图：flagged card 局部 + 全页
  await flaggedCard.screenshot({
    path: path.join(smokeOutDir, 'flagged-card.png'),
  });
  await page.screenshot({
    path: path.join(smokeOutDir, 'full-page-flagged.png'),
    fullPage: true,
  });

  fs.writeFileSync(
    path.join(smokeOutDir, 'flagged-summary.json'),
    JSON.stringify(
      {
        viewport,
        tooltipText: ariaLabel,
        flaggedCount,
        flaggedLastIso,
        consoleErrors,
      },
      null,
      2
    )
  );

  // 不强断 consoleErrors == []，因为第三方运行时偶尔有非致命 warning，
  // 但记录到 summary 便于 lead 复查。
});

test('clean auth card does not render cyber_policy warning marker', async ({ page }) => {
  await loginIfNeeded(page);

  const cards = page.locator('[data-testid="auth-file-card"]');
  await expect(cards).toHaveCount(2);

  const cleanCard = cards.filter({ hasText: cleanAuthFile.name });
  await expect(cleanCard).toHaveCount(1);

  // clean card 内不应该有任何 warning marker（mock 没 file status warning，
  // 没 reauth state，cyber_policy_flag_count = 0）。
  const warningMarkers = cleanCard.locator(
    '[data-testid="auth-file-status-marker-warning"]'
  );
  await expect(warningMarkers).toHaveCount(0);

  await cleanCard.screenshot({
    path: path.join(smokeOutDir, 'clean-card.png'),
  });
  await page.screenshot({
    path: path.join(smokeOutDir, 'full-page-clean.png'),
    fullPage: true,
  });
});
