import fs from 'fs';
import path from 'path';
import { test, expect, request as requestFactory } from '@playwright/test';

const managementUiBase = process.env.MANAGEMENT_UI_BASE || '';
const managementUiRoute = process.env.MANAGEMENT_UI_ROUTE || '#/quota';
const managementKey = process.env.MANAGEMENT_KEY || '';
const smokeOutDir =
  process.env.OUT_DIR ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '../build/playwright-quota-live-smoke');
const ignoreHTTPSErrors = /^(1|true|yes|on)$/i.test(
  process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS || process.env.MANAGEMENT_UI_IGNORE_HTTPS_ERRORS || ''
);
const triggerRefresh = !/^(0|false|no|off)$/i.test(process.env.LIVE_QUOTA_TRIGGER_REFRESH || '1');

const targetUrl = `${managementUiBase}${managementUiRoute}`;
const apiBase = process.env.MANAGEMENT_API_BASE || (managementUiBase ? new URL(managementUiBase).origin : '');

const forbiddenTextPatterns = [
  /额度获取失败/i,
  /Failed to load quota/i,
  /\b401\b/i,
  /authentication_error/i,
  /Invalid authentication credentials/i,
  /invalid character/i,
  /non-JSON/i,
  /Quota snapshot refresh failed/i,
  /Quota snapshot is not available/i,
  /Quota snapshot is empty/i,
];

const pendingTextPatterns = [/正在加载额度/i, /Loading quota/i, /刷新中/i, /Refreshing/i];

const sanitizeUrl = (value) => {
  try {
    const url = new URL(value);
    url.search = url.search ? '<redacted-query>' : '';
    return url.toString();
  } catch {
    return String(value || '');
  }
};

const sanitizeMessage = (value) =>
  String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<redacted-email>')
    .slice(0, 240);

const sanitizeQuotaError = (value) => {
  const sanitized = sanitizeMessage(value);
  if (/(?:\b401\b|authentication_error|Invalid authentication credentials)/i.test(sanitized)) {
    return 'credential needs reauthentication';
  }
  return sanitized;
};

const summarizeSnapshot = (payload) => {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  return entries.map((entry) => ({
    provider: entry?.provider || '',
    status: entry?.status || '',
    plan: entry?.plan_type || '',
    has_snapshot: Boolean(entry?.snapshot),
    error: entry?.error ? sanitizeQuotaError(entry.error) : '',
  }));
};

const writeEvidence = (filename, payload) => {
  fs.mkdirSync(smokeOutDir, { recursive: true });
  fs.writeFileSync(path.join(smokeOutDir, filename), JSON.stringify(payload, null, 2));
};

const readBodyText = async (page) => page.locator('body').innerText({ timeout: 10_000 });

const assertNoForbiddenText = async (page) => {
  const bodyText = await readBodyText(page);
  for (const pattern of forbiddenTextPatterns) {
    expect(bodyText, `page must not contain ${pattern}`).not.toMatch(pattern);
  }
  return bodyText;
};

const waitForQuotaSettled = async (page) => {
  await expect
    .poll(
      async () => {
        const text = await readBodyText(page);
        return pendingTextPatterns.some((pattern) => pattern.test(text));
      },
      { timeout: 180_000, message: 'quota UI should leave loading/refreshing state' }
    )
    .toBe(false);
};

const fetchQuotaSnapshots = async (apiContext) => {
  const response = await apiContext.get(`${apiBase}/v0/management/quota/snapshots`, {
    timeout: 90_000,
  });
  expect(response.ok(), `quota snapshots API status ${response.status()}`).toBeTruthy();
  return response.json();
};

const assertQuotaBusinessState = (entries) => {
  const codexEntries = entries.filter((entry) => entry.provider === 'codex');
  const claudeEntries = entries.filter((entry) => entry.provider === 'claude');

  expect(codexEntries.length, 'test instance should expose Codex auth entries').toBeGreaterThan(0);
  expect(claudeEntries.length, 'test instance should expose Claude auth entries').toBeGreaterThan(0);
  expect(
    codexEntries.filter((entry) => entry.status !== 'ok'),
    'Codex quota snapshots must be ok'
  ).toEqual([]);
  expect(
    claudeEntries.filter((entry) => !['ok', 'reauth_required', 'refresh_disabled'].includes(entry.status)),
    'Claude quota snapshots may be ok, reauth_required, or refresh_disabled only'
  ).toEqual([]);
};

const assertEvidenceSanitized = (payload) => {
  expect(
    JSON.stringify(payload),
    'quota evidence must not expose raw provider authentication failures'
  ).not.toMatch(/\b401\b|authentication_error|Invalid authentication credentials/i);
};

test.use({ ignoreHTTPSErrors });

test('live quota page reads core snapshots and refreshes without visible failures', async ({ page }) => {
  if (!managementUiBase) {
    throw new Error('MANAGEMENT_UI_BASE is required for live quota UI smoke');
  }
  if (!managementKey) {
    throw new Error('MANAGEMENT_KEY is required for live quota UI smoke');
  }

  fs.mkdirSync(smokeOutDir, { recursive: true });

  const consoleMessages = [];
  const requestFailures = [];
  const failedResponses = [];
  const observedQuotaResponses = [];
  const snapshots = {};

  page.on('console', (message) => {
    consoleMessages.push({
      type: message.type(),
      text: sanitizeMessage(message.text()),
      location: message.location(),
    });
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('/favicon.ico')) return;
    requestFailures.push({
      method: request.method(),
      url: sanitizeUrl(request.url()),
      failure: sanitizeMessage(request.failure()?.errorText || ''),
    });
  });
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/favicon.ico')) return;
    if (url.includes('/v0/management/quota/')) {
      observedQuotaResponses.push({
        method: response.request().method(),
        url: sanitizeUrl(url),
        status: response.status(),
      });
    }
    if (response.status() >= 400) {
      failedResponses.push({
        method: response.request().method(),
        url: sanitizeUrl(url),
        status: response.status(),
        statusText: sanitizeMessage(response.statusText()),
      });
    }
  });

  const apiContext = await requestFactory.newContext({
    ignoreHTTPSErrors,
    extraHTTPHeaders: {
      Authorization: `Bearer ${managementKey}`,
    },
  });

  try {
    snapshots.before = summarizeSnapshot(await fetchQuotaSnapshots(apiContext));
    assertQuotaBusinessState(snapshots.before);
    assertEvidenceSanitized(snapshots.before);

    await page.addInitScript(
      ({ base, key }) => {
        window.localStorage.clear();
        window.localStorage.setItem('apiBase', base);
        window.localStorage.setItem('managementKey', key);
        window.localStorage.setItem('isLoggedIn', 'true');
      },
      { base: apiBase, key: managementKey }
    );

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="quota-auto-refresh-panel"]')).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.locator('[data-testid="quota-refresh-now"]')).toBeEnabled({
      timeout: 45_000,
    });

    await waitForQuotaSettled(page);

    if (triggerRefresh) {
      const refreshResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/v0/management/quota/refresh') &&
          response.request().method() === 'POST',
        { timeout: 180_000 }
      );
      await page.locator('[data-testid="quota-refresh-now"]').click();
      const refreshResponse = await refreshResponsePromise;
      expect(refreshResponse.ok(), `quota refresh API status ${refreshResponse.status()}`).toBeTruthy();
      await expect(page.locator('[data-testid="quota-refresh-now"]')).toBeEnabled({
        timeout: 180_000,
      });
      await waitForQuotaSettled(page);
    }
    await assertNoForbiddenText(page);

    snapshots.after = summarizeSnapshot(await fetchQuotaSnapshots(apiContext));
    assertQuotaBusinessState(snapshots.after);
    assertEvidenceSanitized(snapshots.after);

    await page.screenshot({ path: path.join(smokeOutDir, 'quota-live-page.png'), fullPage: true });

    const criticalConsole = consoleMessages.filter((message) => message.type === 'error');
    expect(criticalConsole, 'browser console errors').toEqual([]);
    expect(requestFailures, 'browser request failures').toEqual([]);
    expect(failedResponses, 'HTTP responses >= 400').toEqual([]);

  } finally {
    try {
      await page.screenshot({ path: path.join(smokeOutDir, 'quota-live-final.png'), fullPage: true });
    } catch {
      // The primary assertion failure should remain visible; screenshot failure is secondary.
    }
    writeEvidence('quota-live-evidence.json', { snapshots });
    await apiContext.dispose();
  }
});
