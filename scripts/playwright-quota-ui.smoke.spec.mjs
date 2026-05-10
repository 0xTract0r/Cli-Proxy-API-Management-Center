import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
const managementUiRoute = process.env.MANAGEMENT_UI_ROUTE || '#/quota';
const managementKey = process.env.MANAGEMENT_KEY || 'quotio-dev-management-key';
const smokeOutDir =
  process.env.OUT_DIR ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '../build/playwright-quota-smoke');
const ignoreHTTPSErrors = /^(1|true|yes|on)$/i.test(
  process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS || process.env.MANAGEMENT_UI_IGNORE_HTTPS_ERRORS || ''
);

const targetUrl = `${managementUiBase}${managementUiRoute}`;
const apiBase = process.env.MANAGEMENT_API_BASE || new URL(managementUiBase).origin;

const codexIdPayload = Buffer.from(
  JSON.stringify({ chatgpt_account_id: 'acct-smoke', plan_type: 'plus' }),
  'utf8'
)
  .toString('base64url')
  .replace(/=+$/g, '');

const authFilesPayload = {
  files: [
    {
      name: 'claude-smoke.json',
      provider: 'claude',
      type: 'claude',
      auth_index: 'claude-smoke',
      authIndex: 'claude-smoke',
      status: 'active',
      disabled: false,
    },
    {
      name: 'codex-smoke.json',
      provider: 'codex',
      type: 'codex',
      auth_index: 'codex-smoke',
      authIndex: 'codex-smoke',
      status: 'active',
      disabled: false,
      id_token: `x.${codexIdPayload}.x`,
      plan_type: 'plus',
    },
  ],
};

const fulfillJson = (route, payload, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });

const buildApiCallResponse = (payload) => {
  const url = String(payload?.url || '');
  if (url.includes('codex')) {
    return {
      status_code: 200,
      header: {},
      body: JSON.stringify({
        plan_type: 'plus',
        rate_limit: {
          primary: { used_percent: 12, reset_after_seconds: 1200 },
          secondary: { used_percent: 22, reset_after_seconds: 86400 },
        },
      }),
    };
  }

  return {
    status_code: 200,
    header: {},
    body: JSON.stringify({
      subscription: { plan: 'pro' },
      usage: {
        five_hour: { used_percent: 10, resets_at: new Date(Date.now() + 600_000).toISOString() },
        seven_day: { used_percent: 18, resets_at: new Date(Date.now() + 86_400_000).toISOString() },
      },
    }),
  };
};

async function setupMockedManagementApi(page) {
  let apiCallCount = 0;

  await page.route('**/v0/management/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname.endsWith('/config.yaml')) {
      await route.fulfill({ status: 200, contentType: 'text/yaml', body: 'debug: false\n' });
      return;
    }

    if (pathname.endsWith('/config')) {
      await fulfillJson(route, { debug: false });
      return;
    }

    if (pathname.endsWith('/auth-files')) {
      await fulfillJson(route, authFilesPayload);
      return;
    }

    if (pathname.endsWith('/api-call')) {
      apiCallCount += 1;
      const payload = request.postDataJSON();
      await fulfillJson(route, buildApiCallResponse(payload));
      return;
    }

    await fulfillJson(route, { status: 'ok' });
  });

  await page.addInitScript(
    ({ base, key }) => {
      window.localStorage.setItem('apiBase', base);
      window.localStorage.setItem('managementKey', key);
      window.localStorage.setItem('isLoggedIn', 'true');
      window.localStorage.setItem('quotaAutoRefreshEnabled', 'true');
      window.localStorage.setItem('quotaAutoRefreshIntervalMs', '60000');
    },
    { base: apiBase, key: managementKey }
  );

  return { getApiCallCount: () => apiCallCount };
}

test.use({ ignoreHTTPSErrors });

test('quota page exposes auto-refresh controls and triggers quota refresh', async ({ page }) => {
  fs.mkdirSync(smokeOutDir, { recursive: true });
  const api = await setupMockedManagementApi(page);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="quota-auto-refresh-panel"]')).toBeVisible({
    timeout: 15000,
  });

  const toggle = page.locator('[data-testid="quota-auto-refresh-toggle"]');
  const interval = page.locator('[data-testid="quota-auto-refresh-interval"]');
  const refreshNow = page.locator('[data-testid="quota-refresh-now"]');
  const status = page.locator('[data-testid="quota-auto-refresh-status"]');

  await expect(toggle).toBeChecked();
  await expect(interval).toHaveValue('60000');
  await expect(refreshNow).toBeEnabled();
  await expect(status).toContainText(/Refresh|刷新|打开|Last|上次/i);

  await expect.poll(() => api.getApiCallCount(), { timeout: 15000 }).toBeGreaterThan(0);

  await toggle.setChecked(false);
  await expect(interval).toBeDisabled();
  await page.screenshot({ path: path.join(smokeOutDir, 'quota-auto-refresh-panel.png') });
});
