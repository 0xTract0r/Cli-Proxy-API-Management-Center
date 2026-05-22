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
  {
    name: 'dashboard',
    hash: '#/',
    must: /System Overview|Welcome Back|Overview|系统概览/i,
    settled: [/Current Configuration|当前配置/i],
  },
  {
    name: 'config',
    hash: '#/config',
    must: /Config Panel|配置/i,
    settled: [/Configuration loaded|配置已加载|Visual Editor|可视化编辑/i],
  },
  {
    name: 'ai-providers',
    hash: '#/ai-providers',
    must: /AI Providers|AI 供应商|Provider/i,
    settled: [/Gemini API Keys|Codex API Configuration|Claude API Configuration|OpenAI Compatible Providers/i],
  },
  {
    name: 'auth-files',
    hash: '#/auth-files',
    must: /Auth Files|认证文件|OAuth/i,
    settled: [/Auth Files\s+\d+|认证文件\s+\d+|Upload File|上传文件/i],
  },
  {
    name: 'oauth',
    hash: '#/oauth',
    must: /OAuth|Login|登录/i,
    settled: [/Codex OAuth|Anthropic OAuth|Vertex JSON Login|Cookie Login/i],
  },
  {
    name: 'quota',
    hash: '#/quota',
    must: /Quota|额度/i,
    settled: [/Core-scheduled quota refresh|额度自动刷新|Refresh now|立即刷新/i],
  },
  {
    name: 'usage',
    hash: '#/usage',
    must: /Usage Statistics|使用统计/i,
    settled: [/Service Health|服务健康/i, /API Details|API 明细/i, /Model Statistics|模型统计/i, /Model Pricing Settings|模型价格设置/i],
  },
  {
    name: 'logs',
    hash: '#/logs',
    must: /Logs|日志/i,
    settled: [/Loaded:\s*\d+ lines|No Logs Available|No matching logs found|已加载|暂无日志|未找到匹配日志/i],
  },
  {
    name: 'system',
    hash: '#/system',
    must: /Management Center|System|Info|系统/i,
    settled: [/Connection Status:\s*Connected|连接状态.*已连接|Available Models|可用模型/i],
  },
];

const badUiPattern =
  /额度获取失败|invalid character|0001-01-01|1\/1\/1|quota endpoint returned 401|Invalid authentication credentials|Loading Failed|加载失败|NaN|undefined|null/i;
const loadingPattern =
  /Loading(?:\.\.\.| logs| quota| model| configuration| auth file| account| available)|正在加载|加载中|刷新中|Refreshing/i;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const authFilePattern = /\b(?:codex|claude|gemini|vertex|qwen|kimi|antigravity|iflow)[^\s"'<>]*\.json\b/i;
const keyLikePattern =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z-_]{8,}|hf_[A-Za-z0-9_-]{8,}|pk_[A-Za-z0-9_-]{8,}|rk_[A-Za-z0-9_-]{8,})\b/i;

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const sanitizeEvidenceText = (value) =>
  normalizeText(value)
    .replace(new RegExp(authFilePattern.source, 'gi'), '<redacted-auth-file>')
    .replace(new RegExp(emailPattern.source, 'gi'), '<redacted-email>')
    .replace(new RegExp(keyLikePattern.source, 'gi'), '<redacted-key>');

const sanitizeEvidenceValue = (value) => {
  if (typeof value === 'string') return sanitizeEvidenceText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidenceValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeEvidenceValue(item)]));
  }
  return value;
};

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
  const rawState = await page.locator('main').evaluate((main) => {
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
  return sanitizeEvidenceValue(rawState);
}

function routeUnsettledReasons(route, text) {
  const normalized = normalizeText(text);
  const reasons = [];
  if (loadingPattern.test(normalized)) {
    reasons.push('page still shows loading text');
  }
  for (const pattern of route.settled || []) {
    if (!pattern.test(normalized)) {
      reasons.push(`missing settled marker ${pattern}`);
    }
  }
  if (route.name === 'usage') {
    for (const pattern of [
      /Total Requests\s+-|总请求\s+-/i,
      /Total Tokens\s+-|总\s*Token\s+-/i,
      /\bRPM\s+-/i,
      /\bTPM\s+-/i,
      /API Details\s+Loading|Model Statistics\s+Loading|Credential Statistics\s+Loading|Request Events[\s\S]{0,120}Loading/i,
    ]) {
      if (pattern.test(normalized)) {
        reasons.push(`usage data placeholder still visible ${pattern}`);
      }
    }
  }
  if (route.name === 'logs' && /Loading logs/i.test(normalized)) {
    reasons.push('logs data is still loading');
  }
  return reasons;
}

async function waitForRouteSettled(page, route) {
  await expect
    .poll(
      async () => {
        const text = await page.locator('main').innerText();
        return routeUnsettledReasons(route, text).join('; ');
      },
      { timeout: 60_000, intervals: [250, 500, 1000] }
    )
    .toBe('');
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
  const contextCloseErrors = [];
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
    await waitForRouteSettled(page, route);
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
    expect(state.textSample, `${route.name} evidence text should be sanitized`).not.toMatch(emailPattern);
    expect(state.textSample, `${route.name} evidence text should not include auth filenames`).not.toMatch(authFilePattern);
    expect(routeHttpErrors, `${route.name} should not produce HTTP >=400`).toEqual([]);
    await page.close();
  }
  fs.writeFileSync(path.join(smokeOutDir, 'pages-summary.json'), `${JSON.stringify(routeEvidence, null, 2)}\n`);
  fs.writeFileSync(
    path.join(smokeOutDir, 'browser-events.json'),
    `${JSON.stringify({ consoleErrors, requestFailures, httpErrors, contextCloseErrors }, null, 2)}\n`
  );

  expect(consoleErrors, 'browser console errors').toEqual([]);
  expect(requestFailures, 'browser request failures').toEqual([]);
  expect(httpErrors, 'HTTP >=400 responses').toEqual([]);

  const closeResult = await Promise.race([
    context.close().then(
      () => 'closed',
      (error) => {
        contextCloseErrors.push(String(error?.message || error));
        return 'failed';
      }
    ),
    new Promise((resolve) =>
      setTimeout(() => {
        contextCloseErrors.push('context.close timed out after 5000ms');
        resolve('timeout');
      }, 5000)
    ),
  ]);
  if (closeResult !== 'closed') {
    fs.writeFileSync(
      path.join(smokeOutDir, 'browser-events.json'),
      `${JSON.stringify({ consoleErrors, requestFailures, httpErrors, contextCloseErrors }, null, 2)}\n`
    );
  }
  expect(contextCloseErrors, 'browser context close errors').toEqual([]);
});
