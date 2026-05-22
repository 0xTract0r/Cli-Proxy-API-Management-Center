import fs from 'fs';
import path from 'path';
import { test, expect, request as requestFactory } from '@playwright/test';

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
const usageApiPath = '/v0/management/usage';
const pricingApiPath = '/v0/management/usage/pricing';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const toOptionalNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const parseCompact = (value) => {
  const text = String(value || '').replace(/[$,]/g, '').trim();
  const match = text.match(/^-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const number = Number(match[0]);
  if (!Number.isFinite(number)) return 0;
  if (/m\b/i.test(text)) return number * 1_000_000;
  if (/k\b/i.test(text)) return number * 1_000;
  return number;
};
const parseLineMetric = (lines, matcher) => {
  const line = (lines || []).find((value) => matcher.test(value));
  if (!line) return 0;
  const value = line.includes(':') ? line.split(':').slice(1).join(':') : line;
  return parseCompact(value);
};
const formatForBodyRegex = (value) =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const maskApiKey = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const visibleChars = trimmed.length < 4 ? 1 : 2;
  const start = trimmed.slice(0, visibleChars);
  const end = trimmed.slice(-visibleChars);
  const maskedLength = Math.max(10 - visibleChars * 2, 1);
  return `${start}${'*'.repeat(maskedLength)}${end}`;
};
const maskUsageSensitiveValue = (value) => {
  const raw = String(value || '');
  if (!raw) return '';
  let masked = raw.replace(
    /([?&])(api[-_]?key|key|token|access_token|authorization)=([^&#\s]+)/gi,
    (_full, prefix, keyName, valuePart) => `${prefix}${keyName}=${maskApiKey(valuePart)}`
  );
  masked = masked.replace(
    /(api[-_]?key|key|token|access[-_]?token|authorization)\s*([:=])\s*([A-Za-z0-9._-]+)/gi,
    (_full, keyName, separator, valuePart) => `${keyName}${separator}${maskApiKey(valuePart)}`
  );
  masked = masked.replace(
    /(sk-[A-Za-z0-9]{6,}|AI[a-zA-Z0-9_-]{6,}|AIza[0-9A-Za-z-_]{8,}|hf_[A-Za-z0-9]{6,}|pk_[A-Za-z0-9]{6,}|rk_[A-Za-z0-9]{6,})/g,
    (match) => maskApiKey(match)
  );
  if (masked === raw) {
    const trimmed = raw.trim();
    const looksLikeKey =
      trimmed &&
      !/\s/.test(trimmed) &&
      (/^sk-/i.test(trimmed) ||
        /^AI/i.test(trimmed) ||
        /^AIza/i.test(trimmed) ||
        /^hf_/i.test(trimmed) ||
        /^pk_/i.test(trimmed) ||
        /^rk_/i.test(trimmed) ||
        (!/[\\/]/.test(trimmed) && (/\d/.test(trimmed) || trimmed.length >= 10)) ||
        trimmed.length >= 24);
    if (looksLikeKey) return maskApiKey(trimmed);
  }
  return masked;
};
const endpointDisplayCandidates = (endpoint) =>
  Array.from(new Set([maskUsageSensitiveValue(endpoint)].filter(Boolean)));
const bodyContainsAny = (bodyText, candidates) =>
  candidates.some((candidate) => new RegExp(formatForBodyRegex(candidate), 'i').test(bodyText));
const responsePathnameEquals = (response, pathName) => {
  try {
    return new URL(response.url()).pathname === pathName;
  } catch {
    return false;
  }
};

const extractCacheReadTokens = (tokens) =>
  Math.max(
    toNumber(tokens.cache_read_input_tokens),
    toNumber(tokens.cached_tokens),
    toNumber(tokens.cache_tokens)
  );

const extractCacheWriteTokens = (tokens) =>
  Math.max(toNumber(tokens.cache_write_input_tokens), toNumber(tokens.cache_creation_input_tokens));

const extractTotalTokens = (tokens) => {
  if (typeof tokens.total_tokens === 'number') return tokens.total_tokens;
  return (
    toNumber(tokens.input_tokens) +
    toNumber(tokens.output_tokens) +
    toNumber(tokens.reasoning_tokens) +
    extractCacheReadTokens(tokens) +
    extractCacheWriteTokens(tokens)
  );
};

const calculateDetailCost = (detail, modelPrices) => {
  if (detail.costUsd !== null && detail.costUsd >= 0) return detail.costUsd;
  const price = modelPrices[detail.model];
  if (!price) return 0;
  const inputTokens = toNumber(detail.tokens.input_tokens);
  const outputTokens = toNumber(detail.tokens.output_tokens);
  const cachedTokens = Math.max(toNumber(detail.tokens.cached_tokens), toNumber(detail.tokens.cache_tokens));
  const promptTokens = Math.max(inputTokens - cachedTokens, 0);
  const promptCost = (promptTokens / 1_000_000) * toNumber(price.prompt);
  const cachedCost = (cachedTokens / 1_000_000) * toNumber(price.cache);
  const completionCost = (outputTokens / 1_000_000) * toNumber(price.completion);
  const total = promptCost + cachedCost + completionCost;
  return Number.isFinite(total) && total > 0 ? total : 0;
};

const buildModelPrices = (pricingPayload) => {
  const detected = Array.isArray(pricingPayload?.pricing?.detected_models)
    ? pricingPayload.pricing.detected_models
    : [];
  const prices = {};
  for (const entry of detected) {
    const key = typeof entry?.observed_model === 'string' ? entry.observed_model.trim() : '';
    if (!key) continue;
    const prompt = Number(entry.input_usd_per_mtok);
    const completion = Number(entry.output_usd_per_mtok);
    const cache =
      entry.cached_input_usd_per_mtok === undefined ? prompt : Number(entry.cached_input_usd_per_mtok);
    if (!Number.isFinite(prompt) || !Number.isFinite(completion) || !Number.isFinite(cache)) continue;
    prices[key] = { prompt, completion, cache };
  }
  return prices;
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
          tokens,
          totalTokens: extractTotalTokens(tokens),
          billableTokens: toNumber(tokens.billable_tokens),
          cacheReadTokens: extractCacheReadTokens(tokens),
          cacheWriteTokens: extractCacheWriteTokens(tokens),
          reasoningTokens: toNumber(tokens.reasoning_tokens),
          costUsd: Object.prototype.hasOwnProperty.call(detail, 'cost_usd')
            ? toOptionalNumber(detail.cost_usd)
            : null,
          failed: detail.failed === true,
        });
      }
    }
  }
  return details;
}

function summarizeUsage(payload, modelPrices, sensitiveRawEndpoints = new Set()) {
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
  const missingCostWithoutPrice = [];
  for (const range of ranges) {
    const windowMs =
      range === 'all' ? Infinity : range === '7d' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const filtered = details.filter((detail) => {
      if (range === 'all') return true;
      return detail.timestampMs > 0 && detail.timestampMs >= now - windowMs && detail.timestampMs <= now;
    });
    const byModel = new Map();
    const byEndpoint = new Map();
    for (const detail of filtered) {
      byModel.set(detail.model, (byModel.get(detail.model) || 0) + 1);
      byEndpoint.set(detail.endpoint, (byEndpoint.get(detail.endpoint) || 0) + 1);
    }
    const top = (map, options = {}) =>
      [...map.entries()]
        .map(([name, requests]) => {
          if (options.endpoint) {
            const displayName = maskUsageSensitiveValue(name);
            if (displayName !== name) {
              sensitiveRawEndpoints.add(name);
            }
            return { display_name: displayName, requests };
          }
          return { name, requests };
        })
        .sort((a, b) => {
          const aName = a.name || a.display_name || '';
          const bName = b.name || b.display_name || '';
          return b.requests - a.requests || aName.localeCompare(bName);
        })
        .slice(0, 5);
    const cacheHitRequests = filtered.filter((detail) => detail.cacheReadTokens > 0).length;
    for (const detail of filtered) {
      if (detail.costUsd === null && !modelPrices[detail.model]) {
        missingCostWithoutPrice.push({
          range,
          model: detail.model,
          endpoint_display: maskUsageSensitiveValue(detail.endpoint),
          timestamp: detail.timestamp,
        });
      }
    }
    rangeSummary[range] = {
      request_count_from_details: filtered.length,
      success_count_from_details: filtered.filter((detail) => !detail.failed).length,
      failure_count_from_details: filtered.filter((detail) => detail.failed).length,
      token_count_from_details: filtered.reduce((sum, detail) => sum + detail.totalTokens, 0),
      billable_token_count_from_details: filtered.reduce((sum, detail) => sum + detail.billableTokens, 0),
      cache_read_token_count_from_details: filtered.reduce((sum, detail) => sum + detail.cacheReadTokens, 0),
      cache_write_token_count_from_details: filtered.reduce((sum, detail) => sum + detail.cacheWriteTokens, 0),
      reasoning_token_count_from_details: filtered.reduce((sum, detail) => sum + detail.reasoningTokens, 0),
      cache_hit_rate_percent: filtered.length ? (cacheHitRequests / filtered.length) * 100 : 0,
      total_cost_usd_from_details: filtered.reduce(
        (sum, detail) => sum + calculateDetailCost(detail, modelPrices),
        0
      ),
      top_models: top(byModel),
      top_endpoints: top(byEndpoint, { endpoint: true }),
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
    pricing_coverage: {
      missing_cost_without_price_count: missingCostWithoutPrice.length,
      missing_recent_cost_without_price_count: missingCostWithoutPrice.filter(
        (entry) => entry.range !== 'all'
      ).length,
      missing_cost_without_price_samples: missingCostWithoutPrice.slice(0, 20),
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

async function fetchManagementJSON(apiContext, pathName) {
  const response = await apiContext.get(`${apiBase}${pathName}`, { timeout: 60_000 });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { parse_error: text.slice(0, 200) };
  }
  return { ok: response.ok(), status: response.status(), json };
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
  if (Math.abs(expected) === 0) {
    expect(Math.abs(actual), `${label} should be zero`).toBeLessThanOrEqual(1);
    return;
  }
  expect(actual, `${label} should be positive`).toBeGreaterThan(0);
  const absExpected = Math.abs(expected);
  const compactRoundingTolerance =
    absExpected >= 10_000_000 ? 500_000 : absExpected >= 1_000_000 ? 50_000 : absExpected >= 1_000 ? 50 : 1;
  const tolerance = Math.max(1, absExpected * 0.01, compactRoundingTolerance);
  expect(Math.abs(actual - expected), `${label} should match API within compact-format tolerance`).toBeLessThanOrEqual(tolerance);
}

function assertApproxCount(actual, expected, label) {
  if (Math.abs(expected) === 0) {
    expect(Math.abs(actual), `${label} should be zero`).toBeLessThanOrEqual(1);
    return;
  }
  expect(actual, `${label} should be positive`).toBeGreaterThan(0);
  const tolerance = Math.max(3, Math.abs(expected) * 0.01);
  expect(Math.abs(actual - expected), `${label} should match live API within drift tolerance`).toBeLessThanOrEqual(tolerance);
}

function assertApproxMoney(actual, expected, label) {
  if (Math.abs(expected) === 0) {
    expect(Math.abs(actual), `${label} should be zero`).toBeLessThanOrEqual(0.01);
    return;
  }
  expect(actual, `${label} should be positive`).toBeGreaterThan(0);
  const tolerance = Math.max(0.01, Math.abs(expected) * 0.01);
  expect(Math.abs(actual - expected), `${label} should match API/pricing within money tolerance`).toBeLessThanOrEqual(tolerance);
}

function assertApproxPercent(actual, expected, label) {
  if (Math.abs(expected) === 0) {
    expect(Math.abs(actual), `${label} should be zero`).toBeLessThanOrEqual(0.1);
    return;
  }
  expect(actual, `${label} should be positive`).toBeGreaterThan(0);
  const tolerance = Math.max(0.1, Math.abs(expected) * 0.01);
  expect(Math.abs(actual - expected), `${label} should match API within percent tolerance`).toBeLessThanOrEqual(tolerance);
}

function assertApproxRate(actual, expected, label) {
  if (Math.abs(expected) === 0) {
    expect(Math.abs(actual), `${label} should be zero`).toBeLessThanOrEqual(0.01);
    return;
  }
  expect(actual, `${label} should be positive`).toBeGreaterThan(0);
  const absExpected = Math.abs(expected);
  const formatterTolerance = absExpected >= 100 ? 0.5 : absExpected >= 10 ? 0.05 : 0.005;
  const tolerance = Math.max(formatterTolerance, absExpected * 0.01);
  expect(Math.abs(actual - expected), `${label} should match API within rate-format tolerance`).toBeLessThanOrEqual(tolerance);
}

function assertCardLines(card, expectedLines, label) {
  expect(card, `${label} card should exist`).toBeTruthy();
  for (const matcher of expectedLines) {
    expect(card.text, `${label} card should include ${matcher}`).toMatch(matcher);
  }
}

const usageLoadingPattern =
  /Loading(?:\.\.\.| Failed)?|加载中|加载失败|API Details\s+Loading|Model Statistics\s+Loading|Credential Statistics\s+Loading/i;

const usageComponentPatterns = [
  { key: 'stat_cards', pattern: /Total Requests|总请求/i },
  { key: 'chart_line_selector', pattern: /Lines to display|显示线条/i },
  { key: 'service_health', pattern: /Service Health|服务健康/i },
  { key: 'request_trend_chart', pattern: /Request Trends|请求趋势/i },
  { key: 'token_trend_chart', pattern: /Token Usage Trends|Token 使用趋势/i },
  { key: 'token_breakdown_chart', pattern: /Token Type Breakdown|Token 类型拆分/i },
  { key: 'cost_trend_chart', pattern: /Cost Overview|费用概览/i },
  { key: 'api_details', pattern: /API Details|API 明细/i },
  { key: 'model_statistics', pattern: /Model Statistics|模型统计/i },
  { key: 'request_events', pattern: /Request Events|请求事件/i },
  { key: 'credential_statistics', pattern: /Credential Statistics|凭证统计/i },
  { key: 'pricing_settings', pattern: /Model Pricing Settings|模型价格设置/i },
  { key: 'official_pricing_sources', pattern: /Official pricing sources|官方价格来源/i },
  { key: 'effective_prices', pattern: /Effective prices for usage models|使用模型生效价格/i },
  { key: 'latency_columns', pattern: /Avg Latency|Avg Time|平均延迟|平均耗时/i },
  { key: 'billable_and_cache_columns', pattern: /Billable Tokens|计费Token数量|Cache Hit Rate|缓存命中率/i },
];

async function extractUsageComponentState(page) {
  return page.locator('main').evaluate((main) => ({
    statCardCount: main.querySelectorAll('[class*="statCard"]').length,
    canvasCount: main.querySelectorAll('canvas').length,
    tableCount: main.querySelectorAll('table').length,
    buttonCount: main.querySelectorAll('button').length,
    selectButtonCount: main.querySelectorAll('button[aria-haspopup="listbox"]').length,
    inputCount: main.querySelectorAll('input,textarea,select,[role="textbox"],[contenteditable="true"]').length,
    rowCount: main.querySelectorAll('tr,[role="row"],[class*="row"],[class*="Row"]').length,
  }));
}

function usageUnsettledReasons(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const reasons = [];
  if (usageLoadingPattern.test(normalized)) {
    reasons.push('usage page still shows loading text');
  }
  for (const pattern of [
    /Total Requests\s+-|总请求\s+-/i,
    /Total Tokens\s+-|总\s*Token\s+-/i,
    /\bRPM\s+-/i,
    /\bTPM\s+-/i,
    /Total Cost\s+-|总费用\s+-/i,
  ]) {
    if (pattern.test(normalized)) reasons.push(`usage stat placeholder still visible ${pattern}`);
  }
  for (const { key, pattern } of usageComponentPatterns) {
    if (!pattern.test(normalized)) reasons.push(`missing usage component ${key}`);
  }
  return reasons;
}

async function waitForUsageSettled(page) {
  await expect
    .poll(
      async () => usageUnsettledReasons(await page.locator('main').innerText()).join('; '),
      { timeout: 60_000, intervals: [250, 500, 1000] }
    )
    .toBe('');
}

function assertUsageComponents(bodyText, componentState, range) {
  expect(bodyText, `${range} usage page should not show loading text`).not.toMatch(usageLoadingPattern);
  for (const { key, pattern } of usageComponentPatterns) {
    expect(bodyText, `${range} usage component ${key} should be rendered`).toMatch(pattern);
  }
  expect(componentState.statCardCount, `${range} usage should render stat cards`).toBeGreaterThanOrEqual(5);
  expect(componentState.canvasCount, `${range} usage should render chart canvases`).toBeGreaterThanOrEqual(4);
  expect(componentState.tableCount, `${range} usage should render detail tables`).toBeGreaterThanOrEqual(2);
  expect(componentState.buttonCount, `${range} usage should render controls`).toBeGreaterThanOrEqual(8);
  expect(componentState.selectButtonCount, `${range} usage should render select controls`).toBeGreaterThanOrEqual(1);
  expect(componentState.rowCount, `${range} usage should render data rows`).toBeGreaterThan(10);
}

test.use({ ignoreHTTPSErrors });

test('production usage page data items match management usage API', async ({ page }) => {
  test.setTimeout(150_000);
  fs.mkdirSync(smokeOutDir, { recursive: true });
  const consoleErrors = [];
  const requestFailures = [];
  const httpErrors = [];
  const observedUsageReads = [];
  const observedPricingReads = [];
  let apiContext;
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  page.on('response', (response) => {
    if (response.request().method() === 'GET' && responsePathnameEquals(response, usageApiPath)) {
      observedUsageReads.push({ status: response.status(), url: response.url() });
    }
    if (response.request().method() === 'GET' && responsePathnameEquals(response, pricingApiPath)) {
      observedPricingReads.push({ status: response.status(), url: response.url() });
    }
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });

  try {
    apiContext = await requestFactory.newContext({
      ignoreHTTPSErrors,
      extraHTTPHeaders: { Authorization: `Bearer ${managementKey}` },
    });

    await setupSession(page, '24h');
    await page.goto(`${managementUiBase}#/usage`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(/使用统计|Usage/i, { timeout: 20000 });
    await expect(page.locator('[class*="statCard"]').first()).toBeVisible({ timeout: 20000 });

    const pricingResponse = await fetchManagementJSON(apiContext, pricingApiPath);
    expect(pricingResponse.ok, `pricing API returned ${pricingResponse.status}`).toBe(true);
    const modelPrices = buildModelPrices(pricingResponse.json);
    expect(Object.keys(modelPrices).length, 'pricing API should return detected model prices for cost assertions').toBeGreaterThan(0);

    const usageResponse = await fetchManagementJSON(apiContext, usageApiPath);
    expect(usageResponse.ok, `usage API returned ${usageResponse.status}`).toBe(true);
    const sensitiveRawEndpoints = new Set();
    const usageSummary = summarizeUsage(usageResponse.json, modelPrices, sensitiveRawEndpoints);
    fs.writeFileSync(path.join(smokeOutDir, 'usage-api-summary.json'), `${JSON.stringify(usageSummary, null, 2)}\n`);
    fs.writeFileSync(
      path.join(smokeOutDir, 'pricing-api-summary.json'),
      `${JSON.stringify({ detected_model_price_count: Object.keys(modelPrices).length }, null, 2)}\n`
    );

    const uiByRange = {};
    for (const range of ranges) {
      await selectTimeRange(page, range);
      await waitForUsageSettled(page);
      await expect(page.locator('[class*="statCard"]').filter({ hasText: /Total Requests|总请求/i }).first()).toBeVisible({
        timeout: 20000,
      });
      const cards = await extractUsageCards(page);
      const requestCard = findCard(cards, /总请求|Total Requests|Requests/i);
      const tokenCard = findCard(cards, /总\s*Token|总Token|Total Tokens|Tokens/i);
      const rpmCard = findCard(cards, /\bRPM\b|每分钟请求/i);
      const tpmCard = findCard(cards, /\bTPM\b|每分钟.*Token/i);
      const costCard = findCard(cards, /Total Cost|总费用|费用/i);
      assertCardLines(requestCard, [/Success Requests|成功/i, /Failed Requests|失败/i], `${range} request`);
      assertCardLines(tokenCard, [/Cache Read Tokens|缓存读/i, /Cache Write Tokens|缓存写/i, /Reasoning Tokens|推理/i], `${range} token`);
      assertCardLines(rpmCard, [/Total Requests|总请求/i], `${range} RPM`);
      assertCardLines(tpmCard, [/Total Tokens|总\s*Token|总Token/i], `${range} TPM`);
      assertCardLines(costCard, [/Total Tokens|总\s*Token|总Token/i], `${range} cost`);
      const bodyText = await page.locator('main').innerText();
      const componentState = await extractUsageComponentState(page);
      assertUsageComponents(bodyText, componentState, range);
      uiByRange[range] = {
        cards,
        components: componentState,
        parsed: {
          requests: parseCompact(requestCard?.value),
          successRequests: parseLineMetric(requestCard?.lines, /Success Requests|成功/i),
          failedRequests: parseLineMetric(requestCard?.lines, /Failed Requests|失败/i),
          tokens: parseCompact(tokenCard?.value),
          cacheReadTokens: parseLineMetric(tokenCard?.lines, /Cache Read Tokens|缓存读/i),
          cacheWriteTokens: parseLineMetric(tokenCard?.lines, /Cache Write Tokens|缓存写/i),
          reasoningTokens: parseLineMetric(tokenCard?.lines, /Reasoning Tokens|推理/i),
          cacheHitRatePercent: parseLineMetric(tokenCard?.lines, /Cache Hit Rate|缓存命中/i),
          rpm: parseCompact(rpmCard?.value),
          rpmRequests: parseLineMetric(rpmCard?.lines, /Total Requests|总请求/i),
          tpm: parseCompact(tpmCard?.value),
          tpmTokens: parseLineMetric(tpmCard?.lines, /Total Tokens|总\s*Token|总Token/i),
          costUsd: parseCompact(costCard?.value),
          costTokens: parseLineMetric(costCard?.lines, /Total Tokens|总\s*Token|总Token/i),
        },
      };
      const expected = usageSummary.ranges[range];
      assertApproxCount(uiByRange[range].parsed.requests, expected.request_count_from_details, `${range} UI request total`);
      assertApproxCount(uiByRange[range].parsed.successRequests, expected.success_count_from_details, `${range} UI success total`);
      assertApproxCount(uiByRange[range].parsed.failedRequests, expected.failure_count_from_details, `${range} UI failure total`);
      assertApproxCompact(uiByRange[range].parsed.tokens, expected.token_count_from_details, `${range} UI token total`);
      assertApproxCompact(uiByRange[range].parsed.cacheReadTokens, expected.cache_read_token_count_from_details, `${range} UI cache-read tokens`);
      assertApproxCompact(uiByRange[range].parsed.cacheWriteTokens, expected.cache_write_token_count_from_details, `${range} UI cache-write tokens`);
      assertApproxCompact(uiByRange[range].parsed.reasoningTokens, expected.reasoning_token_count_from_details, `${range} UI reasoning tokens`);
      assertApproxPercent(uiByRange[range].parsed.cacheHitRatePercent, expected.cache_hit_rate_percent, `${range} UI cache hit rate`);
      assertApproxCompact(uiByRange[range].parsed.rpmRequests, usageSummary.rate_30m.request_count, `${range} UI RPM request window`);
      assertApproxCompact(uiByRange[range].parsed.tpmTokens, usageSummary.rate_30m.token_count, `${range} UI TPM token window`);
      assertApproxRate(uiByRange[range].parsed.rpm, usageSummary.rate_30m.rpm, `${range} UI RPM value`);
      assertApproxRate(uiByRange[range].parsed.tpm, usageSummary.rate_30m.tpm, `${range} UI TPM value`);
      assertApproxMoney(uiByRange[range].parsed.costUsd, expected.total_cost_usd_from_details, `${range} UI cost total`);
      if (range === 'all' && usageSummary.root.total_cost_usd > 0) {
        assertApproxMoney(
          uiByRange[range].parsed.costUsd,
          usageSummary.root.total_cost_usd,
          'all UI cost should match API root total_cost_usd'
        );
      }
      assertApproxCompact(uiByRange[range].parsed.costTokens, expected.token_count_from_details, `${range} UI cost-card token total`);

      for (const model of expected.top_models.slice(0, 3)) {
        expect(bodyText, `${range} should render top model ${model.name}`).toMatch(
          new RegExp(formatForBodyRegex(model.name), 'i')
        );
      }
      for (const endpoint of expected.top_endpoints.slice(0, 3)) {
        const candidates = [endpoint.display_name].filter(Boolean);
        expect(
          bodyContainsAny(bodyText, candidates),
          `${range} should render top endpoint display ${candidates.join(' / ')}`
        ).toBe(true);
      }
      expect(bodyText, `${range} should render billable-token and cache-rate columns`).toMatch(
        /Billable Tokens|计费Token数量|Cache Hit Rate|缓存命中率/i
      );
      await page.screenshot({ path: path.join(smokeOutDir, `usage-${range}.png`), fullPage: true });
    }

    fs.writeFileSync(path.join(smokeOutDir, 'usage-ui-summary.json'), `${JSON.stringify(uiByRange, null, 2)}\n`);
    fs.writeFileSync(
      path.join(smokeOutDir, 'browser-events.json'),
      `${JSON.stringify({ consoleErrors, requestFailures, httpErrors, observedUsageReads, observedPricingReads }, null, 2)}\n`
    );

    expect(consoleErrors, 'browser console errors').toEqual([]);
    expect(requestFailures, 'browser request failures').toEqual([]);
    expect(httpErrors.filter((line) => !line.includes('/favicon')), 'HTTP >=400 responses').toEqual([]);
    expect(observedUsageReads.some((entry) => entry.status === 200), 'usage UI should load /v0/management/usage through the browser').toBe(true);
    expect(observedPricingReads.some((entry) => entry.status === 200), 'usage UI should load /v0/management/usage/pricing through the browser').toBe(true);
    expect(usageSummary.root.total_requests, 'usage API root total_requests should not be zero in production').toBeGreaterThan(0);
    expect(usageSummary.root.success_count, 'usage API root success_count should not be zero in production').toBeGreaterThan(0);
    expect(usageSummary.root.failure_count, 'usage API root failure_count should be present').toBeGreaterThanOrEqual(0);
    expect(usageSummary.root.total_tokens, 'usage API root total_tokens should not be zero in production').toBeGreaterThan(0);
    expect(usageSummary.root.total_billable_tokens, 'usage API root total_billable_tokens should not be zero in production').toBeGreaterThan(0);
    expect(usageSummary.root.total_cost_usd, 'usage API root total_cost_usd should not be zero in production').toBeGreaterThan(0);
    expect(usageSummary.structure.detail_count, 'usage API details should exist for UI charts/ranges').toBeGreaterThan(0);
    expect(
      usageSummary.pricing_coverage.missing_recent_cost_without_price_count,
      `recent usage details missing both cost_usd and model price: ${JSON.stringify(usageSummary.pricing_coverage.missing_cost_without_price_samples)}`
    ).toBe(0);
    const evidenceText = JSON.stringify({ usageSummary, uiByRange, observedUsageReads, observedPricingReads });
    for (const rawEndpoint of sensitiveRawEndpoints) {
      expect(evidenceText, 'usage evidence must not contain raw sensitive endpoint values').not.toContain(rawEndpoint);
    }
  } finally {
    fs.writeFileSync(
      path.join(smokeOutDir, 'browser-events.json'),
      `${JSON.stringify({ consoleErrors, requestFailures, httpErrors, observedUsageReads, observedPricingReads }, null, 2)}\n`
    );
    try {
      await page.screenshot({ path: path.join(smokeOutDir, 'usage-final.png'), fullPage: true });
    } catch {
      // Preserve the primary assertion failure if the page is already closed.
    }
    await apiContext?.dispose();
  }
});
