import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
const apiBase = (process.env.MANAGEMENT_API_BASE || new URL(managementUiBase).origin).replace(/\/+$/, '');
const managementKey = process.env.MANAGEMENT_KEY || '';
const smokeOutDir =
  process.env.OUT_DIR ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '../build/playwright-usage-live-data-smoke');
const ignoreHTTPSErrors = /^(1|true|yes|on)$/i.test(
  process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS || process.env.MANAGEMENT_UI_IGNORE_HTTPS_ERRORS || ''
);

const ranges = ['24h', '7d', 'all'];
const timeRangeStorageKey = 'cli-proxy-usage-time-range-v1';
const rangeOptionIndex = { all: 0, '24h': 4, '7d': 5 };

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const parseCompact = (value) => {
  const text = String(value || '').replace(/,/g, '').trim();
  const match = text.match(/^-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const number = Number(match[0]);
  if (!Number.isFinite(number)) return 0;
  if (/m\b/i.test(text)) return number * 1_000_000;
  if (/k\b/i.test(text)) return number * 1_000;
  return number;
};

function unwrapUsage(payload) {
  return isRecord(payload?.usage) ? payload.usage : isRecord(payload) ? payload : {};
}

function collectDetails(usage) {
  const apis = isRecord(usage.apis) ? usage.apis : {};
  const details = [];
  for (const [endpoint, api] of Object.entries(apis)) {
    if (!isRecord(api) || !isRecord(api.models)) continue;
    for (const [model, modelData] of Object.entries(api.models)) {
      if (!isRecord(modelData) || !Array.isArray(modelData.details)) continue;
      for (const detail of modelData.details) {
        if (!isRecord(detail)) continue;
        const timestamp = typeof detail.timestamp === 'string' ? detail.timestamp : '';
        const timestampMs = Date.parse(timestamp);
        const tokens = isRecord(detail.tokens) ? detail.tokens : {};
        details.push({
          endpoint,
          model,
          timestamp,
          timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
          totalTokens: toNumber(tokens.total_tokens),
          failed: detail.failed === true,
        });
      }
    }
  }
  return details;
}

function summarizeUsage(payload) {
  const usage = unwrapUsage(payload);
  const apis = isRecord(usage.apis) ? usage.apis : {};
  const details = collectDetails(usage);
  const timestamps = details.map((detail) => detail.timestampMs).filter((value) => value > 0);
  const modelNames = new Set();
  for (const api of Object.values(apis)) {
    if (!isRecord(api) || !isRecord(api.models)) continue;
    for (const model of Object.keys(api.models)) modelNames.add(model);
  }
  const now = Date.now();
  const rangeSummary = {};
  for (const range of ranges) {
    const windowMs =
      range === 'all' ? Infinity : range === '7d' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const filtered = details.filter((detail) => {
      if (range === 'all') return true;
      return detail.timestampMs > 0 && detail.timestampMs >= now - windowMs && detail.timestampMs <= now;
    });
    rangeSummary[range] = {
      request_count_from_details: filtered.length,
      token_count_from_details: filtered.reduce((sum, detail) => sum + detail.totalTokens, 0),
    };
  }
  const rateDetails = details.filter(
    (detail) => detail.timestampMs > 0 && detail.timestampMs >= now - 30 * 60 * 1000 && detail.timestampMs <= now
  );
  return {
    root: {
      total_requests: toNumber(usage.total_requests),
      success_count: toNumber(usage.success_count),
      failure_count: toNumber(usage.failure_count),
      total_tokens: toNumber(usage.total_tokens),
      total_billable_tokens: toNumber(usage.total_billable_tokens),
      total_cost_usd: toNumber(usage.total_cost_usd),
    },
    structure: {
      api_count: Object.keys(apis).length,
      model_count: modelNames.size,
      detail_count: details.length,
      valid_timestamp_count: timestamps.length,
      invalid_timestamp_count: details.length - timestamps.length,
      min_timestamp: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : '',
      max_timestamp: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : '',
      sample_models: [...modelNames].sort().slice(0, 20),
    },
    ranges: rangeSummary,
    rate_30m: {
      request_count: rateDetails.length,
      token_count: rateDetails.reduce((sum, detail) => sum + detail.totalTokens, 0),
      rpm: rateDetails.length / 30,
      tpm: rateDetails.reduce((sum, detail) => sum + detail.totalTokens, 0) / 30,
    },
  };
}

async function setupSession(page, range) {
  await page.addInitScript(
    ({ base, key, storageKey, timeRange }) => {
      window.localStorage.setItem('apiBase', base);
      window.localStorage.setItem('managementKey', key);
      window.localStorage.setItem('isLoggedIn', 'true');
      window.localStorage.setItem(storageKey, timeRange);
    },
    { base: apiBase, key: managementKey, storageKey: timeRangeStorageKey, timeRange: range }
  );
}

async function fetchManagementJSON(page, pathName) {
  return page.evaluate(
    async ({ base, key, pathName: requestPath }) => {
      const response = await fetch(`${base}${requestPath}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { parse_error: text.slice(0, 200) };
      }
      return { ok: response.ok, status: response.status, json };
    },
    { base: apiBase, key: managementKey, pathName }
  );
}

async function extractUsageCards(page) {
  return page.locator('[class*="statCard"]').evaluateAll((cards) =>
    cards.map((card) => {
      const lines = (card.innerText || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      return {
        text: card.innerText || '',
        label: lines[0] || '',
        value: lines[1] || '',
        lines,
      };
    })
  );
}

function findCard(cards, matcher) {
  return cards.find((card) => matcher.test(card.label) || matcher.test(card.text)) || null;
}

async function selectTimeRange(page, range) {
  const trigger = page
    .locator('button[aria-haspopup="listbox"]')
    .filter({ hasNotText: /Requests|Tokens|Cost|Latency/i })
    .first();
  await trigger.click();
  const optionIndex = rangeOptionIndex[range];
  if (optionIndex === undefined) {
    throw new Error(`unsupported range ${range}`);
  }
  await page.locator('[role="option"]').nth(optionIndex).click();
  await expect(page.locator('[role="listbox"]')).toHaveCount(0, { timeout: 5000 });
  await page.waitForTimeout(800);
}

function assertApproxCompact(actual, expected, label) {
  expect(actual, `${label} should be positive`).toBeGreaterThan(0);
  const tolerance = Math.max(1, Math.abs(expected) * 0.01);
  expect(Math.abs(actual - expected), `${label} should match API within compact-format tolerance`).toBeLessThanOrEqual(tolerance);
}

test.use({ ignoreHTTPSErrors });

test('production usage page data items match management usage API', async ({ page }) => {
  test.setTimeout(90_000);
  fs.mkdirSync(smokeOutDir, { recursive: true });
  const consoleErrors = [];
  const requestFailures = [];
  const httpErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });

  await setupSession(page, '24h');
  await page.goto(`${managementUiBase}#/usage`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toContainText(/使用统计|Usage/i, { timeout: 20000 });
  await expect(page.locator('[class*="statCard"]').first()).toBeVisible({ timeout: 20000 });

  const usageResponse = await fetchManagementJSON(page, '/v0/management/usage');
  expect(usageResponse.ok, `usage API returned ${usageResponse.status}`).toBe(true);
  const usageSummary = summarizeUsage(usageResponse.json);
  fs.writeFileSync(path.join(smokeOutDir, 'usage-api-summary.json'), `${JSON.stringify(usageSummary, null, 2)}\n`);

  const uiByRange = {};
  for (const range of ranges) {
    await selectTimeRange(page, range);
    const cards = await extractUsageCards(page);
    const requestCard = findCard(cards, /总请求|Total Requests|Requests/i);
    const tokenCard = findCard(cards, /总\s*Token|总Token|Total Tokens|Tokens/i);
    const rpmCard = findCard(cards, /\bRPM\b|每分钟请求/i);
    const tpmCard = findCard(cards, /\bTPM\b|每分钟.*Token/i);
    uiByRange[range] = {
      cards,
      parsed: {
        requests: parseCompact(requestCard?.value),
        tokens: parseCompact(tokenCard?.value),
        rpm: parseCompact(rpmCard?.value),
        tpm: parseCompact(tpmCard?.value),
      },
    };
    await page.screenshot({ path: path.join(smokeOutDir, `usage-${range}.png`), fullPage: true });
  }

  fs.writeFileSync(path.join(smokeOutDir, 'usage-ui-summary.json'), `${JSON.stringify(uiByRange, null, 2)}\n`);
  fs.writeFileSync(
    path.join(smokeOutDir, 'browser-events.json'),
    `${JSON.stringify({ consoleErrors, requestFailures, httpErrors }, null, 2)}\n`
  );

  expect(consoleErrors, 'browser console errors').toEqual([]);
  expect(requestFailures, 'browser request failures').toEqual([]);
  expect(httpErrors.filter((line) => !line.includes('/favicon')), 'HTTP >=400 responses').toEqual([]);
  expect(usageSummary.root.total_requests, 'usage API root total_requests should not be zero in production').toBeGreaterThan(0);
  expect(usageSummary.root.total_tokens, 'usage API root total_tokens should not be zero in production').toBeGreaterThan(0);
  expect(usageSummary.structure.detail_count, 'usage API details should exist for UI charts/ranges').toBeGreaterThan(0);

  if (usageSummary.ranges['7d'].request_count_from_details > 0) {
    assertApproxCompact(
      uiByRange['7d'].parsed.requests,
      usageSummary.ranges['7d'].request_count_from_details,
      '7d UI request total'
    );
    assertApproxCompact(
      uiByRange['7d'].parsed.tokens,
      usageSummary.ranges['7d'].token_count_from_details,
      '7d UI token total'
    );
  }
  if (usageSummary.ranges.all.request_count_from_details > 0) {
    assertApproxCompact(
      uiByRange.all.parsed.requests,
      usageSummary.ranges.all.request_count_from_details,
      'all UI request total'
    );
    assertApproxCompact(
      uiByRange.all.parsed.tokens,
      usageSummary.ranges.all.token_count_from_details,
      'all UI token total'
    );
  }
});
