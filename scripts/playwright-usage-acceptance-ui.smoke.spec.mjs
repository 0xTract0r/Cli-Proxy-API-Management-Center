import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
const managementKey = process.env.MANAGEMENT_KEY || 'quotio-dev-management-key';
const apiBase = process.env.MANAGEMENT_API_BASE || new URL(managementUiBase).origin;
const apiKey = process.env.CPA_API_KEY || process.env.API_KEY || '';
const smokeOutDir =
  process.env.OUT_DIR ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '../build/playwright-usage-acceptance-smoke');
const ignoreHTTPSErrors = /^(1|true|yes|on)$/i.test(
  process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS || process.env.MANAGEMENT_UI_IGNORE_HTTPS_ERRORS || ''
);

const hasZeroTimeText = (text) =>
  /0001-01-01|1\/1\/1|0001\/1\/1|0001年|一月\s*1,\s*1/i.test(text || '');

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

async function fetchManagementJSON(page, endpoint) {
  return page.evaluate(
    async ({ base, key, pathName }) => {
      const response = await fetch(`${base}${pathName}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!response.ok) {
        throw new Error(`${pathName} returned ${response.status}`);
      }
      return response.json();
    },
    { base: apiBase, key: managementKey, pathName: endpoint }
  );
}

function modelSnapshot(usage, modelName) {
  const apis = usage?.usage?.apis || {};
  for (const apiStats of Object.values(apis)) {
    const model = apiStats?.models?.[modelName];
    if (model) return model;
  }
  return null;
}

test.use({ ignoreHTTPSErrors });

test('201 usage acceptance data is visible in management UI and APIs', async ({ page }) => {
  fs.mkdirSync(smokeOutDir, { recursive: true });

  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });

  await setupManagementSession(page);

  await page.goto(`${managementUiBase}#/usage`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toContainText(/gpt-5\.5/i, { timeout: 20000 });
  await expect(page.locator('body')).toContainText(/claude-opus-4-7/i, { timeout: 20000 });

  const usage = await fetchManagementJSON(page, '/v0/management/usage');
  fs.writeFileSync(path.join(smokeOutDir, 'usage.json'), `${JSON.stringify(usage, null, 2)}\n`);
  const gpt55 = modelSnapshot(usage, 'gpt-5.5');
  const opus47 = modelSnapshot(usage, 'claude-opus-4-7');

  expect(gpt55, 'gpt-5.5 mock usage should exist').toBeTruthy();
  expect(opus47, 'claude-opus-4-7 mock usage should exist').toBeTruthy();
  expect(gpt55.total_billable_tokens, 'gpt-5.5 billable tokens should exercise cache-inclusive display').toBeGreaterThan(200_000_000);
  expect(opus47.total_billable_tokens, 'claude-opus-4-7 billable tokens should be visible').toBeGreaterThan(700_000);
  expect(gpt55.total_cost_usd, 'gpt-5.5 cost should be priced').toBeGreaterThan(0);
  expect(opus47.total_cost_usd, 'claude-opus-4-7 cost should be priced').toBeGreaterThan(0);

  const usageText = await page.locator('body').innerText();
  expect(hasZeroTimeText(usageText), 'usage page must not render Go zero time').toBe(false);
  await page.screenshot({ path: path.join(smokeOutDir, 'usage-acceptance.png'), fullPage: true });

  await page.goto(`${managementUiBase}#/quota`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toContainText(/claude-bcd898-test-access-only\.json/i, {
    timeout: 20000,
  });

  const quota = await fetchManagementJSON(page, '/v0/management/quota/snapshots');
  fs.writeFileSync(path.join(smokeOutDir, 'quota.json'), `${JSON.stringify(quota, null, 2)}\n`);
  const claudeEntry = (quota.entries || []).find((entry) => entry.provider === 'claude');
  expect(claudeEntry, 'claude quota entry should exist').toBeTruthy();
  expect(claudeEntry.status, 'claude quota entry should be seeded as ok').toBe('ok');
  expect(claudeEntry.snapshot?.usage, 'claude quota snapshot usage should exist').toBeTruthy();
  expect(hasZeroTimeText(claudeEntry.last_refreshed_at), 'quota last refresh must not be zero time').toBe(false);

  const quotaText = await page.locator('body').innerText();
  expect(quotaText, 'quota page should not show stale provider auth failure after seeding').not.toMatch(/Invalid authentication credentials|Quota snapshot is not available/i);
  expect(hasZeroTimeText(quotaText), 'quota page must not render Go zero time').toBe(false);
  await page.screenshot({ path: path.join(smokeOutDir, 'quota-acceptance.png'), fullPage: true });

  if (apiKey) {
    const models = await page.evaluate(
      async ({ base, key }) => {
        const response = await fetch(`${base}/v1/models`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!response.ok) {
          throw new Error(`/v1/models returned ${response.status}`);
        }
        return response.json();
      },
      { base: apiBase, key: apiKey }
    );
    fs.writeFileSync(path.join(smokeOutDir, 'models.json'), `${JSON.stringify(models, null, 2)}\n`);
    const ids = (models.data || []).map((model) => model.id);
    expect(ids, 'Codex Spark must not be exposed without a Pro Codex credential').not.toContain('gpt-5.3-codex-spark');
    expect(ids, 'Claude Opus 1M must not be exposed for a Pro Claude account without extra usage').not.toContain('claude-opus-4-7');
  }

  expect(consoleErrors, 'browser console errors').toEqual([]);
  expect(failedRequests, 'browser failed requests').toEqual([]);
});
