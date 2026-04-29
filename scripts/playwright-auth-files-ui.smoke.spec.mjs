import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const managementUiBase =
  process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
const managementUiRoute = process.env.MANAGEMENT_UI_ROUTE || '#/auth-files';
const managementKey = process.env.MANAGEMENT_KEY || 'quotio-dev-management-key';
const managementApiBase = process.env.MANAGEMENT_API_BASE || '';
const smokeOutDir =
  process.env.OUT_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../build/playwright-auth-files-smoke');
const ignoreHTTPSErrors = /^(1|true|yes|on)$/i.test(
  process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS || process.env.MANAGEMENT_UI_IGNORE_HTTPS_ERRORS || ''
);
const allowDisabledPrimaryActions = /^(1|true|yes|on)$/i.test(
  process.env.PLAYWRIGHT_ALLOW_DISABLED_PRIMARY_ACTIONS ||
    process.env.MANAGEMENT_UI_ALLOW_DISABLED_PRIMARY_ACTIONS ||
    ''
);

const targetUrl = `${managementUiBase}${managementUiRoute}`;
const viewports = [
  { name: 'desktop', width: 1440, height: 1100 },
  { name: 'narrow', width: 1024, height: 1100 },
  { name: 'tight', width: 820, height: 1180 },
  { name: 'compact', width: 680, height: 1180 },
];
const primaryActionSelector =
  '[data-testid="auth-file-action-models"], [data-testid="auth-file-action-refresh"], [data-testid="auth-file-action-reauth"]';

test.use({ ignoreHTTPSErrors });

async function loginIfNeeded(page) {
  if (managementApiBase && managementKey) {
    await page.addInitScript(
      ({ apiBase, key }) => {
        window.localStorage.setItem('apiBase', apiBase);
        window.localStorage.setItem('managementKey', key);
        window.localStorage.setItem('isLoggedIn', 'true');
      },
      { apiBase: managementApiBase, key: managementKey }
    );
  }

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const loginInput = page.getByLabel(/Management Key|管理密钥/i);
  if ((await loginInput.count()) > 0) {
    if (managementApiBase) {
      const customBaseToggle = page.getByLabel(/Custom Connection URL|自定义连接地址/i).first();
      if ((await customBaseToggle.count()) > 0) {
        await customBaseToggle.setChecked(true, { force: true });
        const customBaseInput = page.getByLabel(/Custom Connection URL|自定义连接地址/i).last();
        await customBaseInput.fill(managementApiBase);
      }
    }
    await loginInput.fill(managementKey);
    await page.getByRole('button', { name: /Login|登录/i }).click();
    await page.waitForTimeout(1200);
  }

  if (!page.url().includes('#/auth-files')) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
  }

  await page.waitForSelector('[data-testid="auth-file-card"]', { timeout: 20000 });
}

async function collectCardSummary(page) {
  return page.evaluate(() => {
    const primaryActionSelector =
      '[data-testid="auth-file-action-models"], [data-testid="auth-file-action-refresh"], [data-testid="auth-file-action-reauth"]';

    function findCommonAncestor(elements) {
      if (elements.length === 0) return null;

      let current = elements[0].parentElement;
      while (current) {
        if (elements.every((element) => current.contains(element))) {
          return current;
        }
        current = current.parentElement;
      }

      return null;
    }

    const cards = Array.from(document.querySelectorAll('[data-testid="auth-file-card"]'));
    return cards.slice(0, 6).map((card, index) => {
      const cardRect = card.getBoundingClientRect();
      const primaryButtons = Array.from(card.querySelectorAll(primaryActionSelector));
      const primaryButtonContainer = findCommonAncestor(primaryButtons);
      const utilityActions = card.querySelector('[class*="cardUtilityActions"]');
      const statusToggle = card.querySelector('[class*="statusToggle"]');
      const buttons = primaryButtons.map((button) => {
        const rect = button.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const topElement = document.elementFromPoint(centerX, centerY);
        const topElementCard = topElement?.closest?.('[data-testid="auth-file-card"]');
        return {
          action: button.getAttribute('data-testid') || '',
          title: button.getAttribute('title') || '',
          ariaLabel: button.getAttribute('aria-label') || '',
          disabled: button.hasAttribute('disabled'),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          overflowsRight: rect.right > cardRect.right + 1,
          overflowsLeft: rect.left < cardRect.left - 1,
          hasSpinner: button.querySelector('.loading-spinner') !== null,
          ariaBusy: button.getAttribute('aria-busy') === 'true',
          isCovered:
            topElement !== null &&
            topElement !== button &&
            !button.contains(topElement) &&
            topElementCard !== card,
          top: Math.round(rect.top - cardRect.top),
        };
      });
      const actionRowCount = [
        primaryButtonContainer,
        utilityActions,
        statusToggle,
      ]
        .filter(Boolean)
        .map((element) => Math.round(element.getBoundingClientRect().top - cardRect.top));

      return {
        index,
        cardWidth: Math.round(cardRect.width),
        cardHeight: Math.round(cardRect.height),
        actionIds: buttons.map((button) => button.action),
        actionRowCount: [...new Set(actionRowCount)].length,
        primaryButtonTops: [...new Set(buttons.map((button) => button.top))],
        primaryButtons: buttons,
        hasOverflow: buttons.some((button) => button.overflowsRight || button.overflowsLeft),
        missingLabels: buttons.some((button) => !button.title && !button.ariaLabel),
        hasSpinnerOverlay:
          primaryButtonContainer?.querySelector('.loading-spinner') !== null ||
          buttons.some((button) => button.hasSpinner),
        hasBusyPrimaryAction: buttons.some((button) => button.ariaBusy),
        hasCoveredPrimaryAction: buttons.some((button) => button.isCovered),
      };
    });
  });
}

async function collectFilterPanelSummary(page) {
  return page.evaluate(() => {
    const filterPanel = document.querySelector('[class*="filterControlsPanel"]');
    const filterControls = document.querySelector('[class*="filterControls"]');

    const summarize = (element) =>
      element
        ? {
            clientWidth: Math.round(element.clientWidth),
            scrollWidth: Math.round(element.scrollWidth),
            overflow: element.scrollWidth > element.clientWidth + 1,
          }
        : null;

    return {
      filterPanel: summarize(filterPanel),
      filterControls: summarize(filterControls),
    };
  });
}

async function waitForRefreshButtonsToSettle(page) {
  try {
    await page.waitForFunction(
      (selector) => {
        const refreshButtons = Array.from(document.querySelectorAll(selector));
        if (refreshButtons.length === 0) return true;
        return refreshButtons.every((button) => !button.hasAttribute('disabled'));
      },
      '[data-testid="auth-file-action-refresh"]',
      { timeout: 5000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function verifyStatusMarkerTooltip(page, viewportName) {
  const warningMarker = page.locator('[data-testid="auth-file-status-marker-warning"]').first();
  if ((await warningMarker.count()) === 0) {
    return { checked: false, reason: 'no-warning-marker' };
  }

  const tooltip = warningMarker.locator('[data-testid="auth-file-status-tooltip-warning"]');
  await expect(tooltip).toBeHidden();

  const startedAt = Date.now();
  await warningMarker.hover();
  await expect(tooltip).toBeVisible({ timeout: 250 });
  const elapsedMs = Date.now() - startedAt;
  const text = ((await tooltip.textContent()) || '').trim();
  expect(text.length).toBeGreaterThan(0);

  await warningMarker.hover();
  await page.mouse.move(8, 8);
  await expect(tooltip).toBeHidden({ timeout: 500 });

  return { checked: true, elapsedMs, text, viewportName };
}

test.describe.configure({ mode: 'serial' });

for (const viewport of viewports) {
  test(`auth-files primary actions stay compact on ${viewport.name}`, async ({ page }, testInfo) => {
    fs.mkdirSync(smokeOutDir, { recursive: true });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.context().tracing.start({ screenshots: true, snapshots: true });

    const consoleErrors = [];
    const pageErrors = [];
    const requestFailures = [];
    let cards = [];
    let filterPanel = null;
    let statusTooltip = null;
    let pageRefreshButtonCount = 0;
    let refreshButtonsSettled = false;
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('requestfailed', (request) => {
      requestFailures.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        failureText: request.failure()?.errorText || 'unknown',
      });
    });

    try {
      await loginIfNeeded(page);
      refreshButtonsSettled = await waitForRefreshButtonsToSettle(page);
      if (!allowDisabledPrimaryActions) {
        expect(refreshButtonsSettled, 'refresh buttons should settle before assertions').toBeTruthy();
      }

      cards = await collectCardSummary(page);
      filterPanel = await collectFilterPanelSummary(page);
      statusTooltip = await verifyStatusMarkerTooltip(page, viewport.name);
      pageRefreshButtonCount = await page
        .getByRole('button', { name: /Refresh|Refresh All|刷新|全部刷新/i })
        .count();
      expect(cards.length).toBeGreaterThan(0);

      const actionCards = cards.filter((card) => card.primaryButtons.length > 0);
      expect(actionCards.length).toBeGreaterThan(0);
      const hasCardRefresh = actionCards.some((card) => card.actionIds.includes('auth-file-action-refresh'));
      expect(
        hasCardRefresh || pageRefreshButtonCount > 0,
        'refresh is available either on sampled cards or as a page-level action'
      ).toBeTruthy();
      expect(
        actionCards.some((card) => card.actionIds.includes('auth-file-action-reauth')),
        'at least one sampled card exposes reauth'
      ).toBeTruthy();

      for (const card of actionCards) {
        expect(card.hasOverflow).toBeFalsy();
        expect(card.missingLabels).toBeFalsy();
        expect(card.hasSpinnerOverlay).toBeFalsy();
        expect(card.hasCoveredPrimaryAction).toBeFalsy();
        expect(card.actionRowCount).toBeLessThanOrEqual(2);
        if (!allowDisabledPrimaryActions) {
          expect(card.hasBusyPrimaryAction).toBeFalsy();
        }
        for (const button of card.primaryButtons) {
          expect(button.width).toBeLessThanOrEqual(36);
          expect(button.height).toBeLessThanOrEqual(36);
          expect(button.hasSpinner).toBeFalsy();
          expect(button.isCovered).toBeFalsy();
          if (!allowDisabledPrimaryActions) {
            expect(button.disabled).toBeFalsy();
            expect(button.ariaBusy).toBeFalsy();
          }
        }
      }

      if (viewport.name === 'tight') {
        expect(filterPanel.filterPanel?.overflow).toBeFalsy();
        expect(filterPanel.filterControls?.overflow).toBeFalsy();
      }

      if (viewport.name === 'compact') {
        for (const card of actionCards) {
          expect(card.cardHeight).toBeLessThan(390);
          expect(card.primaryButtonTops.length).toBe(1);
        }
      }

      expect(consoleErrors, 'console errors').toEqual([]);
      expect(pageErrors, 'page errors').toEqual([]);
      expect(requestFailures, 'request failures').toEqual([]);

    } finally {
      await page.screenshot({
        path: path.join(smokeOutDir, `auth-files-${viewport.name}.png`),
        fullPage: true,
      });
      fs.writeFileSync(
        path.join(smokeOutDir, `summary-${viewport.name}.json`),
        JSON.stringify(
          {
            viewport,
            url: page.url(),
            primaryActionSelector,
            ignoreHTTPSErrors,
            allowDisabledPrimaryActions,
            refreshButtonsSettled,
            pageRefreshButtonCount,
            cards,
            filterPanel,
            statusTooltip,
            consoleErrors,
            pageErrors,
            requestFailures,
            status: testInfo.status,
          },
          null,
          2
        )
      );
      await page.context().tracing.stop({
        path: path.join(smokeOutDir, `trace-${viewport.name}.zip`),
      });
    }
  });
}
