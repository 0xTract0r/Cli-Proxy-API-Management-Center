import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const repoRoot = path.resolve('../..');
const outDir = path.join(repoRoot, '.ai/evidence/t064-quota-json-tls-ux/t065-remote-managed-headers');
fs.mkdirSync(outDir, { recursive: true });
const keyDoc = JSON.parse(fs.readFileSync(path.join(repoRoot, 'build/quotio-dev-remote-relay/app-support/remote-management-keys.dev-remote-relay.json'), 'utf8'));
const managementKey = keyDoc.entries['runtime-remote-override'].management_key;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();
const consoleMessages = [];
const failedRequests = [];
page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
page.on('requestfailed', req => failedRequests.push({ url: req.url(), failure: req.failure()?.errorText }));
await page.addInitScript(({ apiBase, key }) => {
  window.localStorage.setItem('apiBase', apiBase);
  window.localStorage.setItem('managementKey', key);
  window.localStorage.setItem('isLoggedIn', 'true');
}, { apiBase: 'https://10.1.1.201:18317', key: managementKey });
await page.goto('https://10.1.1.201:18317/management.html#/auth-files', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="auth-file-card"]', { timeout: 20000 });
const buttons = page.locator('[data-testid="auth-file-action-account-settings"]');
await buttons.first().click();
await page.waitForSelector('[data-testid="account-settings-managed-headers-panel"]', { timeout: 20000 });
await page.screenshot({ path: path.join(outDir, 'modal-first-account.png'), fullPage: true });
const summary = await page.evaluate(() => {
  const panel = document.querySelector('[data-testid="account-settings-managed-headers-panel"]');
  const rows = Array.from(document.querySelectorAll('[data-testid="account-settings-managed-header-row"]'));
  const jsonTrees = Array.from(document.querySelectorAll('[data-testid="account-settings-json-tree"]'));
  const extraEditor = document.querySelector('[data-testid="account-settings-extra-headers-editor-wrapper"] .cm-content');
  const extraExample = document.querySelector('[data-testid="account-settings-extra-headers-example"]');
  return {
    panelText: panel?.textContent || '',
    rowCount: rows.length,
    rows: rows.map(row => row.textContent || ''),
    jsonTreeCount: jsonTrees.length,
    jsonTreeTexts: jsonTrees.slice(0, 3).map(tree => (tree.textContent || '').slice(0, 500)),
    extraHeadersText: extraEditor?.textContent || '',
    extraHeadersExampleText: extraExample?.textContent || '',
    bodyTextPrefix: document.body.textContent?.slice(0, 3000) || '',
  };
});
const result = { summary, consoleMessages, failedRequests };
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
