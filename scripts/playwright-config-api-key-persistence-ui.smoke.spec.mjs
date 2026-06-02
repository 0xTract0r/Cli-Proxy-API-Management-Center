import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { test, expect, request as requestFactory } from '@playwright/test';

const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
const apiBase = (process.env.MANAGEMENT_API_BASE || new URL(managementUiBase).origin).replace(/\/+$/, '');
const managementKey = process.env.MANAGEMENT_KEY || '';
const smokeOutDir =
  process.env.OUT_DIR ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '../build/playwright-config-api-key-persistence-smoke');
const ignoreHTTPSErrors = /^(1|true|yes|on)$/i.test(
  process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS || process.env.MANAGEMENT_UI_IGNORE_HTTPS_ERRORS || ''
);

const apiKeysPath = '/v0/management/api-keys';
const configYamlPath = '/v0/management/config.yaml';

function redactSensitive(value) {
  let text = String(value || '');
  if (managementKey) text = text.split(managementKey).join('<management-key>');
  return text.replace(/Authorization:\s*Bearer\s+[^\n\r]+/gi, 'Authorization: Bearer <management-key>');
}

function maskApiKey(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const visibleChars = trimmed.length < 4 ? 1 : 2;
  const start = trimmed.slice(0, visibleChars);
  const end = trimmed.slice(-visibleChars);
  const maskedLength = Math.max(10 - visibleChars * 2, 1);
  return `${start}${'*'.repeat(maskedLength)}${end}`;
}

function expectIncludesAll(actual, expected, label) {
  for (const key of expected) {
    expect(actual, `${label} should preserve existing key ${maskApiKey(key)}`).toContain(key);
  }
}

async function requestOrThrow(label, fn) {
  try {
    return await fn();
  } catch (err) {
    throw new Error(`${label} failed: ${redactSensitive(err instanceof Error ? err.message : err)}`);
  }
}

async function setupSession(page) {
  await page.addInitScript(
    ({ base, key }) => {
      window.localStorage.setItem('apiBase', base);
      window.localStorage.setItem('managementKey', key);
      window.localStorage.setItem('isLoggedIn', 'true');
      window.localStorage.setItem('config-management:tab', 'visual');
    },
    { base: apiBase, key: managementKey }
  );
}

async function fetchAPIKeys(apiContext) {
  const response = await requestOrThrow('GET /api-keys', () =>
    apiContext.get(`${apiBase}${apiKeysPath}`, { timeout: 60_000 })
  );
  const body = await response.json();
  const keys = body?.['api-keys'];
  return { ok: response.ok(), status: response.status(), keys: Array.isArray(keys) ? keys.map(String) : [] };
}

async function fetchConfigAPIKeys(apiContext) {
  const response = await requestOrThrow('GET /config.yaml', () =>
    apiContext.get(`${apiBase}${configYamlPath}`, { timeout: 60_000 })
  );
  const text = await response.text();
  const parsed = parseYaml(text) || {};
  const keys = Array.isArray(parsed['api-keys']) ? parsed['api-keys'].map(String) : [];
  return { ok: response.ok(), status: response.status(), keys };
}

async function deleteAPIKeyByValue(apiContext, value) {
  return requestOrThrow('DELETE /api-keys', () =>
    apiContext.delete(`${apiBase}${apiKeysPath}?value=${encodeURIComponent(value)}`, {
      timeout: 60_000,
    })
  );
}

test.use({ ignoreHTTPSErrors });

test('config API key editor persists add/edit/delete through management api-keys endpoint', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(smokeOutDir, { recursive: true });

  const consoleErrors = [];
  const requestFailures = [];
  const httpErrors = [];
  const observedWrites = [];
  const tempKey = `sk-ui-persist-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const updatedTempKey = `${tempKey}-edit`;
  let apiContext;

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  page.on('response', (response) => {
    const method = response.request().method();
    let pathname = '';
    try {
      pathname = new URL(response.url()).pathname;
    } catch {
      pathname = '';
    }
    if (pathname === apiKeysPath && ['PUT', 'PATCH', 'DELETE'].includes(method)) {
      observedWrites.push({ method, status: response.status(), url: response.url() });
    }
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });

  try {
    apiContext = await requestFactory.newContext({
      ignoreHTTPSErrors,
      extraHTTPHeaders: { Authorization: `Bearer ${managementKey}` },
    });

    await deleteAPIKeyByValue(apiContext, tempKey).catch(() => {});
    await deleteAPIKeyByValue(apiContext, updatedTempKey).catch(() => {});

    const before = await fetchAPIKeys(apiContext);
    expect(before.ok, `api-keys list returned ${before.status}`).toBe(true);
    expect(before.keys, 'temporary key should not exist before smoke').not.toContain(tempKey);
    expect(before.keys, 'updated temporary key should not exist before smoke').not.toContain(updatedTempKey);

    await setupSession(page);
    await page.goto(`${managementUiBase}#/config`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(/配置管理|Configuration|Config/i, { timeout: 20_000 });
    await page.getByTestId('config-api-key-add').click();

    const addDialog = page.getByRole('dialog', { name: /Add API Key|添加 API 密钥/i });
    await expect(addDialog).toBeVisible({ timeout: 10_000 });
    await addDialog.locator('input').fill(tempKey);
    const addWrite = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === apiKeysPath
    );
    await addDialog.getByRole('button', { name: /^Add$|^添加$/i }).click();
    expect((await addWrite).status(), 'add should PUT /api-keys successfully').toBeLessThan(300);
    await expect(addDialog).toBeHidden({ timeout: 10_000 });

    const afterAddAPI = await fetchAPIKeys(apiContext);
    const afterAddConfig = await fetchConfigAPIKeys(apiContext);
    expect(afterAddAPI.keys.length, 'add should increase API key count by one').toBe(before.keys.length + 1);
    expectIncludesAll(afterAddAPI.keys, before.keys, 'GET /api-keys after add');
    expectIncludesAll(afterAddConfig.keys, before.keys, 'GET /config.yaml after add');
    expect(afterAddAPI.keys, 'GET /api-keys should include the UI-created key').toContain(tempKey);
    expect(afterAddConfig.keys, 'GET /config.yaml should include the UI-created key').toContain(tempKey);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(/配置管理|Configuration|Config/i, { timeout: 20_000 });
    await expect(page.getByTestId('config-api-key-row')).toHaveCount(afterAddAPI.keys.length, {
      timeout: 20_000,
    });

    const addedRow = page.getByTestId('config-api-key-row').filter({ hasText: maskApiKey(tempKey) });
    await expect(addedRow, 'newly added key row should be visible after page reload').toHaveCount(1);
    await addedRow.first().scrollIntoViewIfNeeded();
    await addedRow.first().getByTestId('config-api-key-edit').click();
    const editDialog = page.getByRole('dialog', { name: /Edit API Key|编辑 API 密钥/i });
    await expect(editDialog).toBeVisible({ timeout: 10_000 });
    await editDialog.locator('input').fill(updatedTempKey);
    const editWrite = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === apiKeysPath
    );
    await editDialog.getByRole('button', { name: /Update|更新/i }).click();
    expect((await editWrite).status(), 'edit should PUT /api-keys successfully').toBeLessThan(300);
    await expect(editDialog).toBeHidden({ timeout: 10_000 });

    const afterEditAPI = await fetchAPIKeys(apiContext);
    const afterEditConfig = await fetchConfigAPIKeys(apiContext);
    expect(afterEditAPI.keys.length, 'edit should keep API key count stable').toBe(before.keys.length + 1);
    expectIncludesAll(afterEditAPI.keys, before.keys, 'GET /api-keys after edit');
    expectIncludesAll(afterEditConfig.keys, before.keys, 'GET /config.yaml after edit');
    expect(afterEditAPI.keys, 'GET /api-keys should include edited key').toContain(updatedTempKey);
    expect(afterEditAPI.keys, 'GET /api-keys should not keep original temp key after edit').not.toContain(tempKey);
    expect(afterEditConfig.keys, 'GET /config.yaml should include edited key').toContain(updatedTempKey);

    const editedRow = page.getByTestId('config-api-key-row').filter({ hasText: maskApiKey(updatedTempKey) });
    await expect(editedRow, 'edited key row should be visible before delete').toHaveCount(1);
    const deleteButton = editedRow.first().getByTestId('config-api-key-delete');
    const deleteWrite = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === apiKeysPath
    );
    await deleteButton.click();
    expect((await deleteWrite).status(), 'delete should PUT /api-keys successfully').toBeLessThan(300);

    const afterDeleteAPI = await fetchAPIKeys(apiContext);
    const afterDeleteConfig = await fetchConfigAPIKeys(apiContext);
    expect(afterDeleteAPI.keys.length, 'delete should restore original API key count').toBe(before.keys.length);
    expectIncludesAll(afterDeleteAPI.keys, before.keys, 'GET /api-keys after delete');
    expectIncludesAll(afterDeleteConfig.keys, before.keys, 'GET /config.yaml after delete');
    expect(afterDeleteAPI.keys, 'GET /api-keys should remove edited temp key').not.toContain(updatedTempKey);
    expect(afterDeleteConfig.keys, 'GET /config.yaml should remove edited temp key').not.toContain(updatedTempKey);

    const summary = {
      before_count: before.keys.length,
      after_add_count: afterAddAPI.keys.length,
      after_edit_count: afterEditAPI.keys.length,
      after_delete_count: afterDeleteAPI.keys.length,
      observedWrites,
      consoleErrors,
      requestFailures,
      httpErrors,
    };
    fs.writeFileSync(path.join(smokeOutDir, 'api-key-persistence-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    await page.screenshot({ path: path.join(smokeOutDir, 'config-api-key-persistence-final.png'), fullPage: true });

    expect(observedWrites.some((entry) => entry.method === 'PUT' && entry.status < 300), 'UI should persist API key changes through PUT /api-keys').toBe(true);
    expect(consoleErrors, 'browser console errors').toEqual([]);
    expect(requestFailures, 'browser request failures').toEqual([]);
    expect(httpErrors.filter((line) => !line.includes('/favicon')), 'HTTP >=400 responses').toEqual([]);
  } finally {
    if (apiContext) {
      await deleteAPIKeyByValue(apiContext, tempKey).catch(() => {});
      await deleteAPIKeyByValue(apiContext, updatedTempKey).catch(() => {});
      await apiContext.dispose();
    }
    fs.writeFileSync(
      path.join(smokeOutDir, 'browser-events.json'),
      `${JSON.stringify({ consoleErrors, requestFailures, httpErrors, observedWrites }, null, 2)}\n`
    );
  }
});
