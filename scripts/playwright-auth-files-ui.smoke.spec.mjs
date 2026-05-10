import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const managementUiBase = process.env.MANAGEMENT_UI_BASE || 'http://127.0.0.1:28017/management.html';
const managementUiRoute = process.env.MANAGEMENT_UI_ROUTE || '#/auth-files';
const managementKey = process.env.MANAGEMENT_KEY || 'quotio-dev-management-key';
const managementApiBase = process.env.MANAGEMENT_API_BASE || '';
const smokeOutDir =
  process.env.OUT_DIR ||
  path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../build/playwright-auth-files-smoke'
  );
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
      const actionRowCount = [primaryButtonContainer, utilityActions, statusToggle]
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

async function verifyAccountSettingsManagedHeaderUi(page) {
  const settingsButtons = page.locator('[data-testid="auth-file-action-account-settings"]');
  const settingsButtonCount = await settingsButtons.count();
  expect(settingsButtonCount, 'account settings action should be visible').toBeGreaterThan(0);

  const inspected = [];
  for (let index = 0; index < settingsButtonCount; index += 1) {
    const button = settingsButtons.nth(index);
    if ((await button.isDisabled()) || !(await button.isVisible())) continue;

    await button.click();
    await expect(
      page.locator('[data-testid="account-settings-managed-headers-panel"]')
    ).toBeVisible({
      timeout: 10000,
    });

    const generatedPanels = page.locator(
      [
        '[data-testid="account-settings-managed-headers-panel"]',
        '[data-testid="account-settings-managed-policy-panel"]',
        '[data-testid="account-settings-managed-history-panel"]',
      ].join(', ')
    );
    const generatedInputCount = await generatedPanels
      .locator('textarea, input, select, [contenteditable="true"]')
      .count();
    const readOnlyViewerSelectors = [
      '[data-testid="account-settings-auth-file-info-viewer"]',
      '[data-testid="account-settings-save-payload-preview"]',
      '[data-testid="account-settings-runtime-profile-viewer"]',
      '[data-testid="account-settings-runtime-identity-viewer"]',
      '[data-testid="account-settings-warnings-viewer"]',
    ];
    const readOnlyViewerCount = await page.locator(readOnlyViewerSelectors.join(', ')).count();
    const readOnlyInputLikeCount = await page
      .locator(readOnlyViewerSelectors.join(', '))
      .locator('textarea, input, select, [contenteditable="true"]')
      .count();
    const jsonTreeCount = await page.locator('[data-testid="account-settings-json-tree"]').count();
    const jsonViewerCopyCount = await page
      .locator('[data-testid="account-settings-json-viewer-copy"]')
      .count();
    const rawJsonDetails = page.locator('[data-testid="account-settings-raw-json-details"]');
    const rawJsonDetailsCount = await rawJsonDetails.count();
    const rawJsonDetailsOpen =
      rawJsonDetailsCount > 0
        ? await rawJsonDetails.first().evaluate((node) => node.hasAttribute('open'))
        : true;
    const tlsSummaryPanelCount = await page
      .locator('[data-testid="account-settings-tls-summary-panel"]')
      .count();
    const managedHeaderTableCount = await page
      .locator('[data-testid="account-settings-managed-headers-panel"] table')
      .count();
    const transportJsonEditorCount = await page
      .locator('[data-testid="account-settings-transport-profile-editor-wrapper"] .cm-editor')
      .count();
    const tlsJsonEditorCount = await page
      .locator('[data-testid="account-settings-tls-profile-editor-wrapper"] .cm-editor')
      .count();
    const extraHeadersJsonEditorCount = await page
      .locator('[data-testid="account-settings-extra-headers-editor-wrapper"] .cm-editor')
      .count();
    const extraHeadersExampleCount = await page
      .locator('[data-testid="account-settings-extra-headers-example"]')
      .count();
    const advancedProfileTextareaCount = await page
      .locator(
        [
          '[data-testid="account-settings-transport-profile-editor-wrapper"] textarea.input',
          '[data-testid="account-settings-tls-profile-editor-wrapper"] textarea.input',
        ].join(', ')
      )
      .count();
    const extraHeadersTextareaCount = await page
      .locator('[data-testid="account-settings-extra-headers-textarea"]')
      .count();
    const enabledToggleCount = await page
      .locator('[data-testid="account-settings-enabled-toggle"]')
      .count();
    const refreshToggleCount = await page
      .locator('[data-testid="account-settings-refresh-enabled-toggle"]')
      .count();
    const managedHeaderRowCount = await page
      .locator('[data-testid="account-settings-managed-header-row"]')
      .count();
    const policyPanelCount = await page
      .locator('[data-testid="account-settings-managed-policy-panel"]')
      .count();
    const policyRuleCount = await page
      .locator('[data-testid="account-settings-managed-policy-rule"]')
      .count();
    const sourceStatusCount = await page
      .locator('[data-testid="account-settings-managed-source"]')
      .count();
    const historyPanelCount = await page
      .locator('[data-testid="account-settings-managed-history-panel"]')
      .count();
    const historyDetailsToggleCount = await page
      .locator('[data-testid="account-settings-managed-history-details-toggle"]')
      .count();

    expect(generatedInputCount, 'managed/generated sections must not use inputs').toBe(0);
    expect(readOnlyViewerCount, 'readonly previews should render as code viewers').toBeGreaterThan(
      0
    );
    expect(readOnlyInputLikeCount, 'readonly previews must not contain input controls').toBe(0);
    expect(jsonTreeCount, 'readonly JSON should render as collapsible JSON trees').toBeGreaterThan(
      0
    );
    expect(jsonViewerCopyCount, 'readonly JSON viewer should expose copy actions').toBeGreaterThan(
      0
    );
    expect(rawJsonDetailsCount, 'raw JSON previews should be grouped as advanced details').toBe(1);
    expect(rawJsonDetailsOpen, 'raw JSON previews should not hide core-managed headers above the fold').toBe(
      false
    );
    expect(tlsSummaryPanelCount, 'TLS/runtime profile should render a human summary').toBeGreaterThan(
      0
    );
    expect(managedHeaderTableCount, 'managed headers should use a real table').toBe(1);
    expect(transportJsonEditorCount, 'transport profile should use CodeMirror JSON editor').toBe(1);
    expect(tlsJsonEditorCount, 'TLS profile should use CodeMirror JSON editor').toBe(1);
    expect(extraHeadersJsonEditorCount, 'extra headers should use CodeMirror JSON editor').toBe(1);
    expect(extraHeadersExampleCount, 'extra headers should show an inline JSON example').toBe(1);
    expect(advancedProfileTextareaCount, 'transport/TLS profile should not use plain textarea.input').toBe(0);
    expect(extraHeadersTextareaCount, 'extra headers should not use the old plain textarea').toBe(0);
    expect(enabledToggleCount, 'enabled toggle should use enabled semantics').toBe(1);
    expect(refreshToggleCount, 'refresh-enabled toggle should be visible').toBe(1);
    if (policyPanelCount > 0) {
      expect(policyRuleCount, 'policy panel should explain the auto-update rule').toBeGreaterThan(
        0
      );
      expect(sourceStatusCount, 'policy panel should disclose the managed header source').toBeGreaterThan(
        0
      );
    }
    if (managedHeaderRowCount > 0) {
      await expect(
        page.locator('[data-testid="account-settings-managed-headers-panel"]'),
        'managed header panel should show concrete header names, not an empty box'
      ).toContainText(/User-Agent|Version|X-App|Originator|Accept-Language/i);
      const managedBox = await page
        .locator('[data-testid="account-settings-managed-headers-panel"]')
        .boundingBox();
      const rawBox = await rawJsonDetails.first().boundingBox();
      if (managedBox && rawBox) {
        expect(
          managedBox.y,
          'managed headers should be above advanced raw JSON previews'
        ).toBeLessThan(rawBox.y);
      }
    }
    if (historyPanelCount > 0) {
      expect(
        historyDetailsToggleCount,
        'history panel should expose a details entry point'
      ).toBeGreaterThan(0);

      await page
        .locator('[data-testid="account-settings-managed-history-details-toggle"]')
        .first()
        .click();

      const diffTableCount = await page
        .locator('[data-testid="account-settings-managed-history-diff-table"]')
        .count();
      const fallbackCount = await page
        .locator('[data-testid="account-settings-managed-history-no-diff"]')
        .count();

      if (diffTableCount > 0) {
        const diffTable = page
          .locator('[data-testid="account-settings-managed-history-diff-table"]')
          .first();
        await expect(diffTable).toContainText(/Previous|Next|上一个|下一个/i);
        expect(
          await diffTable.locator('code').count(),
          'history diff should render previous/next values'
        ).toBeGreaterThanOrEqual(2);
      } else {
        expect(
          fallbackCount,
          'history details should show a no-diff fallback when field-level diff is absent'
        ).toBeGreaterThan(0);
      }
    }

    const summary = {
      index,
      managedHeaderRowCount,
      policyPanelCount,
      policyRuleCount,
      sourceStatusCount,
      historyPanelCount,
      historyDetailsToggleCount,
      generatedInputCount,
      readOnlyViewerCount,
      readOnlyInputLikeCount,
      jsonTreeCount,
      jsonViewerCopyCount,
      rawJsonDetailsCount,
      rawJsonDetailsOpen,
      tlsSummaryPanelCount,
      managedHeaderTableCount,
      transportJsonEditorCount,
      tlsJsonEditorCount,
      extraHeadersJsonEditorCount,
      extraHeadersExampleCount,
      advancedProfileTextareaCount,
      enabledToggleCount,
      extraHeadersTextareaCount,
      refreshToggleCount,
      managedHeadersText: (
        (await page
          .locator('[data-testid="account-settings-managed-headers-panel"]')
          .innerText()) || ''
      ).slice(0, 500),
      policyText:
        policyPanelCount > 0
          ? (
              (await page
                .locator('[data-testid="account-settings-managed-policy-panel"]')
                .innerText()) || ''
            ).slice(0, 500)
          : '',
      historyText:
        historyPanelCount > 0
          ? (
              (await page
                .locator('[data-testid="account-settings-managed-history-panel"]')
                .innerText()) || ''
            ).slice(0, 500)
          : '',
    };
    inspected.push(summary);

    if (
      managedHeaderRowCount > 0 &&
      policyPanelCount > 0 &&
      policyRuleCount > 0 &&
      sourceStatusCount > 0 &&
      (historyPanelCount === 0 || historyDetailsToggleCount > 0)
    ) {
      await page.keyboard.press('Escape');
      return {
        checked: true,
        settingsButtonCount,
        inspected,
      };
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }

  expect(
    inspected.some((item) => item.managedHeaderRowCount > 0),
    'at least one account settings modal should show runtime managed header rows'
  ).toBeTruthy();
  expect(
    inspected.some((item) => item.policyPanelCount > 0),
    'at least one account settings modal should show core auto-upgrade policy summary'
  ).toBeTruthy();
  expect(
    inspected.some((item) => item.policyRuleCount > 0),
    'at least one policy summary should explain the auto-update rule'
  ).toBeTruthy();
  expect(
    inspected.some((item) => item.sourceStatusCount > 0),
    'at least one policy summary should disclose the managed header source'
  ).toBeTruthy();
  const inspectedHistoryPanels = inspected.filter((item) => item.historyPanelCount > 0);
  if (inspectedHistoryPanels.length > 0) {
    expect(
      inspectedHistoryPanels.some((item) => item.historyDetailsToggleCount > 0),
      'managed header history entries should expose details when history exists'
    ).toBeTruthy();
  }

  return {
    checked: true,
    settingsButtonCount,
    inspected,
  };
}

test.describe.configure({ mode: 'serial' });

for (const viewport of viewports) {
  test(`auth-files primary actions stay compact on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    fs.mkdirSync(smokeOutDir, { recursive: true });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.context().tracing.start({ screenshots: true, snapshots: true });

    const consoleErrors = [];
    const pageErrors = [];
    const requestFailures = [];
    let cards = [];
    let filterPanel = null;
    let statusTooltip = null;
    let accountSettingsUi = null;
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
        expect(
          refreshButtonsSettled,
          'refresh buttons should settle before assertions'
        ).toBeTruthy();
      }

      cards = await collectCardSummary(page);
      filterPanel = await collectFilterPanelSummary(page);
      statusTooltip = await verifyStatusMarkerTooltip(page, viewport.name);
      if (viewport.name === 'desktop') {
        accountSettingsUi = await verifyAccountSettingsManagedHeaderUi(page);
      }
      pageRefreshButtonCount = await page
        .getByRole('button', { name: /Refresh|Refresh All|刷新|全部刷新/i })
        .count();
      expect(cards.length).toBeGreaterThan(0);

      const actionCards = cards.filter((card) => card.primaryButtons.length > 0);
      expect(actionCards.length).toBeGreaterThan(0);
      const hasCardRefresh = actionCards.some((card) =>
        card.actionIds.includes('auth-file-action-refresh')
      );
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
            accountSettingsUi,
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
