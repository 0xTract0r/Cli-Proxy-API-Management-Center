import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
const configuredMaxOkRefreshAgeHours = Number(process.env.LIVE_QUOTA_MAX_OK_AGE_HOURS || '24');
const maxOkRefreshAgeHours =
  Number.isFinite(configuredMaxOkRefreshAgeHours) && configuredMaxOkRefreshAgeHours > 0
    ? configuredMaxOkRefreshAgeHours
    : 24;
const requirePolicy = /^(1|true|yes|on)$/i.test(process.env.LIVE_QUOTA_REQUIRE_POLICY || '');
const supportedProviders = new Set(
  (process.env.LIVE_QUOTA_SUPPORTED_PROVIDERS || 'codex,claude')
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean)
);

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
const emptyTextPatterns = [
  /暂无额度/i,
  /暂无数据/i,
  /没有额度/i,
  /No quota data/i,
  /No data/i,
  /No snapshots/i,
];
const zeroTimePattern = /0001-01-01|1\/1\/1|0001\/1\/1|0001年|一月\s*1,\s*1/i;
const configAutoRefreshTitlePattern =
  /Quota auto-refresh|额度自动刷新|Обновление квот ядром по расписанию/i;
const configRefreshIntervalPattern =
  /Refresh interval \(minutes\)|刷新间隔（分钟）|Интервал автообновления/i;

const canonicalPolicySchema = [
  { field: 'enabled', type: 'boolean' },
  { field: 'interval_seconds', type: 'number' },
  { field: 'jitter_seconds', type: 'number' },
  { field: 'startup_catch_up', type: 'boolean' },
  { field: 'startup_max_staleness_seconds', type: 'number' },
];

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

const stableHash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 10);

const sanitizeAuthLabel = (value, fallback) => {
  const sanitized = sanitizeMessage(value);
  if (!sanitized) return fallback;
  const basename = sanitized.includes('/') ? path.basename(sanitized) : sanitized;
  const looksLikeFilename = /\.(json|ya?ml|txt)$/i.test(basename);
  if (!looksLikeFilename && (basename.length > 48 || /^[A-Za-z0-9._~+/=-]{24,}$/.test(basename))) {
    return `sha256:${stableHash(basename)}`;
  }
  return basename;
};

const authLabelForEntry = (entry, index) => {
  const candidates = [
    entry?.auth_name,
    entry?.auth_file,
    entry?.auth_file_name,
    entry?.file_name,
    entry?.filename,
    entry?.name,
    entry?.display_name,
    entry?.credential_name,
    entry?.auth_index,
    entry?.authIndex,
    entry?.account_id,
    entry?.chatgpt_account_id,
    entry?.credential_id,
    entry?.id,
    entry?.email,
    entry?.auth?.name,
    entry?.auth?.id,
  ];
  const value = candidates.find((candidate) => candidate !== undefined && candidate !== null && String(candidate));
  return sanitizeAuthLabel(value, `entry#${index + 1}`);
};

const policyFor = (value) => value?.policy ?? value?.refresh_policy ?? null;

const policyEntriesFor = (value) => {
  if (!value || typeof value !== 'object') return [];
  const entries = [];
  if (Object.prototype.hasOwnProperty.call(value, 'policy')) {
    entries.push({ source: 'policy', value: value.policy });
  }
  if (Object.prototype.hasOwnProperty.call(value, 'refresh_policy')) {
    entries.push({ source: 'refresh_policy', value: value.refresh_policy });
  }
  return entries;
};

const policySourceFor = (value) => policyEntriesFor(value)[0]?.source || '';

const valueTypeFor = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'non-finite number';
  return typeof value;
};

const policyFieldIsValid = (value, expectedType) => {
  if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expectedType;
};

const validatePolicySchema = (policy, label) => {
  const isObject = Boolean(policy) && typeof policy === 'object' && !Array.isArray(policy);
  const fields = canonicalPolicySchema.map(({ field, type }) => {
    const present = isObject && Object.prototype.hasOwnProperty.call(policy, field);
    const actualValue = present ? policy[field] : undefined;
    const valid = present && policyFieldIsValid(actualValue, type);
    return {
      field,
      expected_type: type,
      actual_type: present ? valueTypeFor(actualValue) : 'missing',
      present,
      valid,
    };
  });

  const problems = [];
  if (!isObject) {
    problems.push(`${label}: policy/refresh_policy must be an object, got ${valueTypeFor(policy)}`);
  } else {
    for (const field of fields) {
      if (!field.valid) {
        problems.push(
          `${label}: canonical field ${field.field} must be ${field.expected_type}, got ${field.actual_type}`
        );
      }
    }
  }

  return {
    valid: problems.length === 0,
    fields,
    problems,
  };
};

const policySchemaChecksFor = (value, location) =>
  policyEntriesFor(value).map(({ source, value: policy }) => ({
    location,
    source,
    ...validatePolicySchema(policy, `${location}.${source}`),
  }));

const timestampAgeHours = (value) => {
  if (!value || zeroTimePattern.test(String(value))) return null;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return null;
  return Math.round(((Date.now() - timestamp) / 3_600_000) * 10) / 10;
};

const hasUsableSnapshot = (entry) => {
  if (!entry?.snapshot || typeof entry.snapshot !== 'object') return false;
  return Object.keys(entry.snapshot).length > 0;
};

const summarizeQuotaPayload = (payload) => {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  return {
    policy: policyFor(payload),
    policy_source: policySourceFor(payload),
    policy_schema_checks: policySchemaChecksFor(payload, 'response'),
    entry_count: entries.length,
    entries: entries.map((entry, index) => {
      const lastRefreshedAt = entry?.last_refreshed_at || entry?.lastRefreshedAt || '';
      const nextRefreshAt = entry?.next_refresh_at || entry?.nextRefreshAt || '';
      const snapshotKeys =
        entry?.snapshot && typeof entry.snapshot === 'object' ? Object.keys(entry.snapshot).sort() : [];
      return {
        provider: String(entry?.provider || '').toLowerCase(),
        auth: authLabelForEntry(entry, index),
        disabled: entry?.disabled === true,
        status: entry?.status || '',
        plan: entry?.plan_type || entry?.planType || '',
        has_snapshot: hasUsableSnapshot(entry),
        snapshot_keys: snapshotKeys,
        last_refreshed_at: lastRefreshedAt,
        last_refreshed_age_hours: timestampAgeHours(lastRefreshedAt),
        next_refresh_at: nextRefreshAt,
        zero_time: zeroTimePattern.test(JSON.stringify(entry || {})),
        policy: policyFor(entry),
        policy_source: policySourceFor(entry),
        policy_schema_checks: policySchemaChecksFor(entry, `entries[${index}]`),
        error: entry?.error ? sanitizeQuotaError(entry.error) : '',
      };
    }),
  };
};

const writeEvidence = (filename, payload) => {
  fs.mkdirSync(smokeOutDir, { recursive: true });
  fs.writeFileSync(path.join(smokeOutDir, filename), `${JSON.stringify(payload, null, 2)}\n`);
};

const readBodyText = async (page) => page.locator('body').innerText({ timeout: 10_000 });

const assertNoForbiddenText = async (page) => {
  const bodyText = await readBodyText(page);
  for (const pattern of forbiddenTextPatterns) {
    expect(bodyText, `page must not contain ${pattern}`).not.toMatch(pattern);
  }
  expect(bodyText, 'quota page must not render Go zero time').not.toMatch(zeroTimePattern);
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

const formatEntry = (entry) =>
  `provider=${entry.provider || '<missing>'} auth=${entry.auth || '<missing>'} status=${
    entry.status || '<missing>'
  } disabled=${entry.disabled === true} plan=${entry.plan || '<missing>'} has_snapshot=${entry.has_snapshot} last_refreshed_at=${
    entry.last_refreshed_at || '<missing>'
  } age_hours=${entry.last_refreshed_age_hours ?? '<unknown>'}`;

const assertQuotaBusinessState = (snapshot, label) => {
  const entries = snapshot.entries || [];
  const codexEntries = entries.filter((entry) => entry.provider === 'codex');
  const claudeEntries = entries.filter((entry) => entry.provider === 'claude');
  const activeSupportedEntries = entries.filter(
    (entry) => supportedProviders.has(entry.provider) && entry.disabled !== true
  );
  const policySchemaChecks = [
    ...(snapshot.policy_schema_checks || []),
    ...entries.flatMap((entry) => entry.policy_schema_checks || []),
  ];
  const problems = [];

  expect(codexEntries.length, 'test instance should expose Codex auth entries').toBeGreaterThan(0);
  expect(claudeEntries.length, 'test instance should expose Claude auth entries').toBeGreaterThan(0);
  expect(entries.length, 'quota snapshots API should return at least one entry').toBeGreaterThan(0);

  for (const entry of activeSupportedEntries) {
    if (entry.zero_time) {
      problems.push(`${label}: zero-time timestamp: ${formatEntry(entry)}`);
    }
    if (entry.status === 'unsupported') {
      problems.push(`${label}: supported provider reported unsupported: ${formatEntry(entry)}`);
    }
    if (entry.status === 'stale') {
      problems.push(`${label}: stale status cannot pass live quota gate: ${formatEntry(entry)}`);
    }
    if (entry.provider === 'codex' && !['ok', 'refresh_disabled'].includes(entry.status)) {
      problems.push(`${label}: Codex quota entry must be ok: ${formatEntry(entry)}`);
    }
    if (entry.provider === 'claude' && !['ok', 'reauth_required', 'refresh_disabled'].includes(entry.status)) {
      problems.push(`${label}: Claude status must be ok, reauth_required, or refresh_disabled: ${formatEntry(entry)}`);
    }
    if (entry.status === 'ok' && !entry.has_snapshot) {
      problems.push(`${label}: ok status requires a quota snapshot: ${formatEntry(entry)}`);
    }
    if (entry.status === 'ok' && entry.last_refreshed_age_hours === null) {
      problems.push(`${label}: ok status requires a valid last_refreshed_at: ${formatEntry(entry)}`);
    }
    if (entry.status === 'ok' && entry.last_refreshed_age_hours > maxOkRefreshAgeHours) {
      problems.push(`${label}: ok snapshot older than ${maxOkRefreshAgeHours}h: ${formatEntry(entry)}`);
    }
  }

  if (requirePolicy && policySchemaChecks.length === 0) {
    problems.push(`${label}: LIVE_QUOTA_REQUIRE_POLICY=1 but quota response did not include policy/refresh_policy`);
  }
  for (const policyCheck of policySchemaChecks) {
    if (!policyCheck.valid) {
      problems.push(...policyCheck.problems.map((problem) => `${label}: ${problem}`));
    }
  }

  expect(problems, `quota business state problems:\n${problems.join('\n')}`).toEqual([]);
};

const assertEvidenceSanitized = (payload) => {
  expect(
    JSON.stringify(payload),
    'quota evidence must not expose raw provider authentication failures'
  ).not.toMatch(/\b401\b|authentication_error|Invalid authentication credentials/i);
};

const assertUiShowsQuotaData = async (page, snapshot) => {
  const bodyText = await assertNoForbiddenText(page);
  for (const pattern of emptyTextPatterns) {
    expect(bodyText, `quota page must not show empty/no-data state ${pattern}`).not.toMatch(pattern);
  }

  const providerNames = Array.from(
    new Set((snapshot.entries || []).map((entry) => entry.provider).filter((provider) => supportedProviders.has(provider)))
  );
  const providerPattern = new RegExp(providerNames.map((provider) => provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  expect(
    providerPattern.test(bodyText),
    `quota page should render at least one supported provider from API: ${providerNames.join(', ')}`
  ).toBe(true);
};

const assertReadOnlyDidNotRefresh = (observedQuotaResponses, blockedRefreshRequests) => {
  if (triggerRefresh) return;
  const refreshPosts = observedQuotaResponses.filter(
    (response) => response.method === 'POST' && response.url.includes('/v0/management/quota/refresh')
  );
  expect(refreshPosts, 'LIVE_QUOTA_TRIGGER_REFRESH=0 must not issue quota refresh POST').toEqual([]);
  expect(blockedRefreshRequests, 'read-only guard blocked unexpected quota refresh POST').toEqual([]);
};

const assertUiLoadedQuotaSnapshots = (observedQuotaResponses) => {
  const snapshotReads = observedQuotaResponses.filter(
    (response) => response.method === 'GET' && response.url.includes('/v0/management/quota/snapshots')
  );
  expect(snapshotReads.length, 'quota UI should load quota snapshots through the browser').toBeGreaterThan(0);
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
  const blockedRefreshRequests = [];
  const snapshots = {};
  const uiChecks = {};
  let apiContext;
  let traceStarted = false;

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

  try {
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    traceStarted = true;

    if (!triggerRefresh) {
      await page.route('**/v0/management/quota/refresh', async (route) => {
        if (route.request().method() === 'POST') {
          blockedRefreshRequests.push({
            method: route.request().method(),
            url: sanitizeUrl(route.request().url()),
          });
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'quota live smoke is running in read-only mode' }),
          });
          return;
        }
        await route.continue();
      });
    }

    apiContext = await requestFactory.newContext({
      ignoreHTTPSErrors,
      extraHTTPHeaders: {
        Authorization: `Bearer ${managementKey}`,
      },
    });

    snapshots.before = summarizeQuotaPayload(await fetchQuotaSnapshots(apiContext));
    assertQuotaBusinessState(snapshots.before, 'before');
    assertEvidenceSanitized(snapshots.before);

    await page.addInitScript(
      ({ base, key, readonly }) => {
        window.localStorage.clear();
        window.localStorage.setItem('apiBase', base);
        window.localStorage.setItem('managementKey', key);
        window.localStorage.setItem('isLoggedIn', 'true');
        if (readonly) {
          window.localStorage.setItem('quotaAutoRefreshEnabled', 'false');
        }
      },
      { base: apiBase, key: managementKey, readonly: !triggerRefresh }
    );

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="quota-auto-refresh-panel"]')).toBeVisible({
      timeout: 45_000,
    });
    const configLink = page.locator('[data-testid="quota-auto-refresh-config-link"]');
    await expect(configLink).toBeVisible({ timeout: 45_000 });
    await expect(configLink).toHaveAttribute('href', /#\/config\?section=quota$/);
    uiChecks.quota_config_link_href = sanitizeUrl(await configLink.getAttribute('href'));
    await expect(page.locator('[data-testid="quota-refresh-now"]')).toBeEnabled({
      timeout: 45_000,
    });

    await waitForQuotaSettled(page);
    await assertUiShowsQuotaData(page, snapshots.before);

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
    assertReadOnlyDidNotRefresh(observedQuotaResponses, blockedRefreshRequests);
    await assertUiShowsQuotaData(page, snapshots.before);

    snapshots.after = summarizeQuotaPayload(await fetchQuotaSnapshots(apiContext));
    assertQuotaBusinessState(snapshots.after, 'after');
    assertEvidenceSanitized(snapshots.after);

    await page.screenshot({ path: path.join(smokeOutDir, 'quota-live-page.png'), fullPage: true });

    await configLink.click();
    await expect(page).toHaveURL(/#\/config\?section=quota/);
    await expect(page.getByRole('heading', { name: configAutoRefreshTitlePattern })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText(configRefreshIntervalPattern)).toBeVisible({ timeout: 45_000 });
    uiChecks.quota_config_link_reached = true;
    await page.screenshot({
      path: path.join(smokeOutDir, 'quota-config-link-page.png'),
      fullPage: true,
    });

    const criticalConsole = consoleMessages.filter((message) => message.type === 'error');
    assertUiLoadedQuotaSnapshots(observedQuotaResponses);
    expect(criticalConsole, 'browser console errors').toEqual([]);
    expect(requestFailures, 'browser request failures').toEqual([]);
    expect(failedResponses, 'HTTP responses >= 400').toEqual([]);
    assertReadOnlyDidNotRefresh(observedQuotaResponses, blockedRefreshRequests);

  } finally {
    if (traceStarted) {
      try {
        await page.context().tracing.stop({ path: path.join(smokeOutDir, 'quota-live-trace.zip') });
      } catch {
        // The primary assertion failure should remain visible; trace failure is secondary.
      }
    }
    try {
      await page.screenshot({ path: path.join(smokeOutDir, 'quota-live-final.png'), fullPage: true });
    } catch {
      // The primary assertion failure should remain visible; screenshot failure is secondary.
    }
    writeEvidence('quota-live-evidence.json', {
      config: {
        target_url: sanitizeUrl(targetUrl),
        api_base: sanitizeUrl(apiBase),
        trigger_refresh: triggerRefresh,
        max_ok_refresh_age_hours: maxOkRefreshAgeHours,
        supported_providers: Array.from(supportedProviders).sort(),
        require_policy: requirePolicy,
        policy_schema: canonicalPolicySchema,
      },
      snapshots,
      diagnostics: {
        ui_checks: uiChecks,
        console_messages: consoleMessages,
        request_failures: requestFailures,
        failed_responses: failedResponses,
        observed_quota_responses: observedQuotaResponses,
        blocked_refresh_requests: blockedRefreshRequests,
      },
    });
    await apiContext?.dispose();
  }
});
