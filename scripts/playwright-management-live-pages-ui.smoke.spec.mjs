import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
const apiBase = (process.env.MANAGEMENT_API_BASE || new URL(managementUiBase).origin).replace(/\/+$/, '');
const managementKey = process.env.MANAGEMENT_KEY || '';
const smokeOutDir =
  process.env.OUT_DIR ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '../build/playwright-management-live-pages-smoke');
const ignoreHTTPSErrors = /^(1|true|yes|on)$/i.test(
  process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS || process.env.MANAGEMENT_UI_IGNORE_HTTPS_ERRORS || ''
);

const routes = [
  { name: 'dashboard', hash: '#/', must: /System Overview|Welcome Back|Overview|系统概览/i },
  { name: 'config', hash: '#/config', must: /Config Panel|配置/i },
  { name: 'ai-providers', hash: '#/ai-providers', must: /AI Providers|AI 供应商|Provider/i },
  { name: 'auth-files', hash: '#/auth-files', must: /Auth Files|认证文件|OAuth/i },
  { name: 'oauth', hash: '#/oauth', must: /OAuth|Login|登录/i },
  { name: 'quota', hash: '#/quota', must: /Quota|额度/i },
  { name: 'usage', hash: '#/usage', must: /Usage Statistics|使用统计/i },
  { name: 'logs', hash: '#/logs', must: /Logs|日志/i },
  { name: 'system', hash: '#/system', must: /Management Center|System|Info|系统/i },
];

const badUiPattern =
  /额度获取失败|invalid character|0001-01-01|1\/1\/1|quota endpoint returned 401|Invalid authentication credentials|NaN|undefined|null/i;

async function setupSession(target) {
  await target.addInitScript(
    ({ base, key }) => {
      window.localStorage.setItem('apiBase', base);
      window.localStorage.setItem('managementKey', key);
      window.localStorage.setItem('isLoggedIn', 'true');
      window.localStorage.setItem('cli-proxy-usage-time-range-v1', '24h');
    },
    { base: apiBase, key: managementKey }
  );
}

async function collectPageState(page) {
  return page.locator('main').evaluate((main) => {
    const mainText = main.innerText || '';
    const visibleText = mainText.replace(/\s+/g, ' ').trim();
    return {
      title: document.title,
      textSample: visibleText.slice(0, 2000),
      bodyTextLength: visibleText.length,
      headings: Array.from(main.querySelectorAll('h1,h2,h3'))
        .map((el) => el.textContent?.trim())
        .filter(Boolean)
        .slice(0, 30),
      buttons: Array.from(main.querySelectorAll('button'))
        .map((el) => el.textContent?.trim() || el.getAttribute('aria-label') || '')
        .filter(Boolean)
        .slice(0, 80),
      links: Array.from(main.querySelectorAll('a'))
        .map((el) => el.textContent?.trim() || el.getAttribute('href') || '')
        .filter(Boolean)
        .slice(0, 80),
      counts: {
        buttons: main.querySelectorAll('button').length,
        links: main.querySelectorAll('a').length,
        inputs: main.querySelectorAll('input,textarea,select,[role="textbox"],[contenteditable="true"]').length,
        statCards: main.querySelectorAll('[class*="statCard"]').length,
        cards: main.querySelectorAll('[class*="card"],[class*="Card"]').length,
        tables: main.querySelectorAll('table,[role="table"],[role="grid"]').length,
        rows: main.querySelectorAll('tr,[role="row"],[class*="row"],[class*="Row"]').length,
        listItems: main.querySelectorAll('li,[role="listitem"]').length,
      },
    };
  });
}

test.use({ ignoreHTTPSErrors });

test('production management pages render real data components without visible failures', async ({ browser }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(smokeOutDir, { recursive: true });
  const context = await browser.newContext({ ignoreHTTPSErrors });
  await setupSession(context);
  const consoleErrors = [];
  const requestFailures = [];
  const httpErrors = [];
  const routeEvidence = {};

  for (const route of routes) {
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`${route.name}: ${message.text()}`);
    });
    page.on('requestfailed', (request) => {
      requestFailures.push(`${route.name}: ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
    });
    page.on('response', (response) => {
      if (response.status() >= 400 && !response.url().includes('/favicon')) {
        httpErrors.push(`${route.name}: ${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });
    const beforeHttpCount = httpErrors.length;
    await page.goto(`${managementUiBase}${route.hash}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toContainText(route.must, { timeout: 20000 });
    await page.waitForTimeout(800);
    const state = await collectPageState(page);
    await page.screenshot({ path: path.join(smokeOutDir, `${route.name}.png`), fullPage: true });
    const routeHttpErrors = httpErrors.slice(beforeHttpCount);
    routeEvidence[route.name] = {
      hash: route.hash,
      state,
      httpErrors: routeHttpErrors,
    };

    expect(state.bodyTextLength, `${route.name} should not render an empty body`).toBeGreaterThan(80);
    expect(state.counts.buttons + state.counts.links, `${route.name} should render interactive controls`).toBeGreaterThan(0);
    expect(state.textSample, `${route.name} should not show known bad UI text`).not.toMatch(badUiPattern);
    expect(routeHttpErrors, `${route.name} should not produce HTTP >=400`).toEqual([]);
    await page.close();
  }
  await context.close();

  fs.writeFileSync(path.join(smokeOutDir, 'pages-summary.json'), `${JSON.stringify(routeEvidence, null, 2)}\n`);
  fs.writeFileSync(
    path.join(smokeOutDir, 'browser-events.json'),
    `${JSON.stringify({ consoleErrors, requestFailures, httpErrors }, null, 2)}\n`
  );

  expect(consoleErrors, 'browser console errors').toEqual([]);
  expect(requestFailures, 'browser request failures').toEqual([]);
  expect(httpErrors, 'HTTP >=400 responses').toEqual([]);
});
