// 确定性回归测试：认证文件页「测试发送消息」不应因被测账号 401 而登出整个前端。
//
// 背景（根因）：全局 axios 响应拦截器对任何 401 一刀切派发 'unauthorized' → logout()。
// 而 /auth-files/test-message 端点会把「被测账号」上游认证失败的 401 原样透传为自身
// HTTP 状态码。于是测一个坏号（凭证失效）就会把管理会话登出、跳回登录页。
// 修复在 src/services/api/client.ts：账号级探测端点的 401 豁免全局登出。
//
// 本 spec 全程用路由拦截 mock，不依赖真实后端：
//   - 主用例：mock POST /auth-files/test-message -> 401，断言未登出、错误就地展示。
//   - 对照用例：mock 一个「管理端点」-> 401，断言仍然登出（管理 token 真过期不被误伤）。

import { test, expect } from '@playwright/test';

// 静态服务器由 runner 脚本注入 BASE_URL（服务 dist/ 单文件构建）。
const baseUrl = process.env.MOCK_UI_BASE_URL || 'http://127.0.0.1:4319';
const authFilesUrl = `${baseUrl}/index.html#/auth-files`;
const loginUrl = `${baseUrl}/index.html#/login`;

const nowIso = '2026-07-09T00:00:00Z';

// mock 一个认证文件（claude 坏号）。
const sampleAuthFile = {
  name: 'claude-bad-account.json',
  type: 'claude',
  provider: 'claude',
  source: 'file',
  size: 2048,
  modified: Date.parse(nowIso),
  note: 'bad-account',
  status: 'error',
  statusMessage: 'auth failed',
};

// 注入登录态：与仓库现有 mock smoke 一致，写入明文 localStorage，
// restoreSession 会迁移为混淆存储并用 mock /config 完成 login() -> isAuthenticated=true。
async function injectLoggedInState(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('apiBase', '');
    window.localStorage.setItem('managementKey', 'mock-management-key');
    window.localStorage.setItem('isLoggedIn', 'true');
  });
}

// 安装管理 API mock。testMessageStatus 控制 /auth-files/test-message 的返回码；
// managementFail=true 时让某个「管理端点」(/config 之外的 /auth-files 列表) 返回 401，
// 用于对照用例证明管理级 401 仍然触发登出。
// getStatus 返回值用于动态翻转某端点的返回码（如先放行加载、后翻成 401 触发登出）。
async function installManagementApiMock(
  page,
  {
    testMessageStatus = 200,
    getConfigStatus = () => 200,
    getRefreshStatusStatus = () => 200,
  } = {}
) {
  await page.route('**/v0/management/**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const respond = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
        headers: {
          'X-CPA-VERSION': 'playwright-mock',
          'X-CPA-COMMIT': 'mock',
          'X-CPA-BUILD-DATE': nowIso,
        },
      });

    // login() 依赖 /config 成功才会置 isAuthenticated=true —— 默认放行，可翻转成 401。
    if (pathname.endsWith('/config')) {
      if (getConfigStatus() === 401) return respond({ error: 'management session expired (401)' }, 401);
      return respond({
        debug: false,
        'api-keys': [],
        'proxy-url': '',
        'request-retry': 2,
        'usage-statistics-enabled': false,
        routing: { strategy: 'round-robin' },
      });
    }

    // 被测端点：模拟被测账号上游认证失败的 401 透传。
    if (pathname.endsWith('/auth-files/test-message')) {
      if (testMessageStatus === 401) {
        return respond({ error: 'upstream authentication failed (401)' }, 401);
      }
      return respond({
        status: 'success',
        provider: 'claude',
        model: 'claude-sonnet-4',
        latency_ms: 123,
        output_preview: 'OK',
      });
    }

    // 刷新状态：非白名单账号级端点，可翻转成 401 用于加固用例。
    if (pathname.endsWith('/auth-files/refresh-status')) {
      if (getRefreshStatusStatus() === 401) return respond({ error: 'management session expired (401)' }, 401);
      return respond({ status: 'ok', error: '', file: sampleAuthFile });
    }

    // 模型列表：返回一个模型，让测试弹窗的提交按钮可用。
    if (pathname.includes('/auth-files/models')) {
      return respond({ models: [{ id: 'claude-sonnet-4' }] });
    }

    // 认证文件列表。
    if (pathname.endsWith('/auth-files')) {
      return respond({ files: [sampleAuthFile], total: 1 });
    }

    // 其它辅助端点一律 200 空响应，避免噪声。
    if (pathname.endsWith('/usage')) return respond({ usage: {} });
    if (pathname.endsWith('/oauth-reauth-history')) return respond({ events: [] });
    if (pathname.endsWith('/auth-status-history')) return respond({ events: [] });
    if (pathname.includes('/model-definitions/')) return respond({ models: [] });
    if (pathname.endsWith('/auth-files/account-settings')) {
      return respond({ name: url.searchParams.get('name') || '', account_settings: {} });
    }
    return respond({});
  });
}

async function gotoAuthFiles(page) {
  await injectLoggedInState(page);
  await page.goto(authFilesUrl, { waitUntil: 'domcontentloaded' });
  // 等待受保护路由完成 restoreSession -> login -> 渲染卡片。
  await page.waitForSelector('[data-testid="auth-file-card"]', { timeout: 20000 });
}

// —— 主用例：被测账号 401 不应登出 ——
test('测试发送消息返回 401（被测账号失效）不触发全局登出', async ({ page }) => {
  await installManagementApiMock(page, { testMessageStatus: 401 });
  await gotoAuthFiles(page);

  // 打开测试发送消息弹窗并提交。
  await page.getByTestId('auth-file-action-test-message').first().click();
  const submit = page.getByTestId('auth-file-test-message-submit');
  await expect(submit).toBeVisible();
  await expect(submit).toBeEnabled();
  await submit.click();

  // 断言 1：错误就地在弹窗内展示（不是白屏跳走）。
  await expect(page.getByTestId('auth-file-test-message-result-error')).toBeVisible({ timeout: 10000 });

  // 断言 2：URL 仍在 auth-files 页，没有跳到 /login。
  await expect.poll(() => page.url(), { timeout: 3000 }).toContain('#/auth-files');
  expect(page.url()).not.toContain('#/login');

  // 断言 3：管理态未被清空（登录页的管理密钥输入框不存在）。
  await expect(page.getByTestId('auth-file-card').first()).toBeVisible();
});

// —— 对照用例：管理级 401 仍应登出（防回归，确认修复没放过真正的会话过期）——
// 走真实的管理会话校验路径：/config 是 login()/refresh 都会打的管理端点，让它返回 401，
// 点击「Refresh All」触发 fetchConfig(force) -> apiClient.get('/config') -> 401 ->
// 全局拦截器 unauthorized -> logout。/config 不在账号级探测豁免名单里，应照常登出。
test('管理端点(/config)返回 401（管理会话过期）仍然触发登出', async ({ page }) => {
  // 首次加载放行（login 成功渲染卡片），随后翻转 /config 为 401 再手动刷新触发。
  let configShouldFail = false;
  await installManagementApiMock(page, { getConfigStatus: () => (configShouldFail ? 401 : 200) });
  await gotoAuthFiles(page);

  // 翻转 /config 为 401，点击「Refresh All」触发一次真实管理端点请求。
  configShouldFail = true;
  await page.getByRole('button', { name: /Refresh All|刷新全部/i }).first().click();

  // 断言：管理级 401 触发登出，跳转到登录页。
  await expect.poll(() => page.url(), { timeout: 10000 }).toContain('#/login');
  void loginUrl;
});

// —— 加固用例：豁免名单是精确匹配、且足够窄 ——
// /auth-files/refresh-status 是同一 `/auth-files/` 前缀下的 sibling 账号级端点，但经核对
// core 后端（gitlink 9c295240）恒返回 200 包 body、不透传上游 401，因此**不在**豁免名单里。
// 这里首次加载放行、渲染卡片后翻转 refresh-status 为 401，点击单卡片的刷新状态按钮，
// 断言仍然触发登出——证明 isAccountLevelProbeUrl 用精确相等匹配，不会因为共享
// `/auth-files/` 前缀而误豁免其它端点。
test('非白名单的账号级端点(/auth-files/refresh-status)返回 401 仍然触发登出', async ({ page }) => {
  let refreshShouldFail = false;
  await installManagementApiMock(page, {
    getRefreshStatusStatus: () => (refreshShouldFail ? 401 : 200),
  });
  await gotoAuthFiles(page);

  // 翻转 refresh-status 为 401，点击单卡片的「刷新状态」按钮触发请求。
  refreshShouldFail = true;
  await page.getByTestId('auth-file-action-refresh').first().click();

  // 断言：非白名单端点的 401 仍然登出。
  await expect.poll(() => page.url(), { timeout: 10000 }).toContain('#/login');
});
