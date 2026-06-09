import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
const managementUiRoute = process.env.MANAGEMENT_UI_ROUTE || '#/usage';
const managementKey = process.env.MANAGEMENT_KEY || 'quotio-dev-management-key';
const apiBase = process.env.MANAGEMENT_API_BASE || new URL(managementUiBase).origin;
const smokeOutDir =
  process.env.OUT_DIR ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '../build/playwright-usage-pricing-smoke');
const ignoreHTTPSErrors = /^(1|true|yes|on)$/i.test(
  process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS || process.env.MANAGEMENT_UI_IGNORE_HTTPS_ERRORS || ''
);
const runPricingRefresh = /^(1|true|yes|on)$/i.test(process.env.RUN_PRICING_REFRESH || '');
const requirePersistedAt = !/^(0|false|no|off)$/i.test(process.env.REQUIRE_PRICING_PERSISTED_AT || '1');

const targetUrl = `${managementUiBase}${managementUiRoute}`;
const runtimeDetectionPath = '/v0/management/nodes';

const hasZeroTimeText = (text) =>
  /0001-01-01|1\/1\/1|0001\/1\/1|0001年|一月\s*1,\s*1/i.test(text || '');

const isRuntimeDetectionProbeUrl = (value) => {
  try {
    return new URL(value).pathname === runtimeDetectionPath;
  } catch {
    return String(value || '').includes(runtimeDetectionPath);
  }
};

const isExpectedRuntimeDetectionConsoleError = (message) => {
  if (message.type() !== 'error') return false;
  if (!isRuntimeDetectionProbeUrl(message.location().url || '')) return false;
  return /Failed to load resource|404|405/i.test(message.text());
};

async function setupManagementSession(page) {
  await page.addInitScript(
    ({ base, key }) => {
      window.localStorage.setItem('apiBase', base);
      window.localStorage.setItem('managementKey', key);
      window.localStorage.setItem('isLoggedIn', 'true');
    },
    { base: apiBase, key: managementKey }
  );
}

async function pricingSnapshot(page) {
  return page.evaluate(async ({ base, key }) => {
    const response = await fetch(`${base}/v0/management/usage/pricing`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      throw new Error(`pricing API returned ${response.status}`);
    }
    return response.json();
  }, { base: apiBase, key: managementKey });
}

test.use({ ignoreHTTPSErrors });

test('usage pricing page shows persisted catalog state without zero-time regressions', async ({ page }) => {
  fs.mkdirSync(smokeOutDir, { recursive: true });

  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isExpectedRuntimeDetectionConsoleError(message)) {
      consoleErrors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });

  await setupManagementSession(page);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('body')).toContainText(/模型价格设置|Model Pricing Settings|Model price settings/i, {
    timeout: 20000,
  });
  await expect(page.locator('body')).toContainText(/目录持久化时间|Catalog persisted at/i, {
    timeout: 20000,
  });

  if (runPricingRefresh) {
    const refreshButton = page.getByRole('button', { name: /刷新官方价格|Refresh official pricing/i });
    await expect(refreshButton).toBeEnabled({ timeout: 10000 });
    await refreshButton.click();
    await expect(refreshButton).not.toHaveAttribute('aria-busy', 'true', { timeout: 90000 });
  }

  const snapshot = await pricingSnapshot(page);
  const official = snapshot?.pricing?.official || {};
  const persistedAt = official.persisted_at || '';
  const lastRefreshedAt = official.last_refreshed_at || '';
  const sources = Array.isArray(official.sources) ? official.sources : [];

  fs.writeFileSync(
    path.join(smokeOutDir, 'usage-pricing-snapshot.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`
  );

  expect(lastRefreshedAt, 'official pricing should have a refresh timestamp').toBeTruthy();
  expect(hasZeroTimeText(lastRefreshedAt), 'official refresh timestamp must not be a zero time').toBe(false);
  if (requirePersistedAt) {
    expect(persistedAt, 'pricing catalog should have a persisted timestamp').toBeTruthy();
    expect(hasZeroTimeText(persistedAt), 'pricing persisted timestamp must not be a zero time').toBe(false);
  }
  expect(sources.length, 'official pricing sources should be visible').toBeGreaterThan(0);
  expect(sources.some((source) => source.status === 'ok'), 'at least one official pricing source should be ok').toBe(true);

  const bodyText = await page.locator('body').innerText();
  expect(hasZeroTimeText(bodyText), 'UI must not render Go zero time').toBe(false);
  expect(bodyText, 'UI must not hide pricing persistence failures behind success').not.toMatch(/permission denied|failed to persist|持久化失败/i);

  await page.screenshot({ path: path.join(smokeOutDir, 'usage-pricing.png'), fullPage: true });

  expect(consoleErrors, 'browser console errors').toEqual([]);
  expect(failedRequests, 'browser failed requests').toEqual([]);
});
