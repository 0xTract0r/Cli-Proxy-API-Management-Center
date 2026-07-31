// @ts-nocheck
// 占位单测（telemetry-device-farm T18「账号健康显示如实化」）：见
// src/components/ui/HealthPill.test.tsx 顶部说明——本仓库当前未接入
// Vitest/@testing-library/react（apps/web/package.json 无相关 devDependency，
// 也无 vitest.config），`vitest`/`@testing-library/react` 模块目前无法解析。
// `@ts-nocheck` 只是为了不让这个占位文件在没装依赖前拖垮 `tsc`/`npm run build`
// （tsconfig `include: ["src"]` 会把它一并类型检查，即便没有任何真实代码
// import 它）；一旦接入测试运行时，请删掉这行并让类型检查正常生效。
// 这个文件本身不会被任何脚本执行，只作为账号健康显示如实化验收骨架，覆盖：
//  ① 启用开关只反映 file.disabled 本身的 operator 意图、始终可点，不再因
//     isQuarantined 改写 checked/disabled 或转只读（2026-07-31 用户实测后
//     反转作废「隔离态显关+只读」的 Path B 旧实现，见 tasks.md task #20）；
//     隔离状态改由独立的「已隔离」徽标呈现，不借助开关的假「关」态表达；
//  ④ 隔离原因 / status_message / 最近失败次数从 hover tooltip 提升为卡片常驻
//     可见文本。
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
// 触发 i18next.init()（副作用 import），让 useTranslation() 在没有
// <I18nextProvider> 包裹时也能正常解析文案；期望文案统一用同一个 i18n 实例的
// t() 计算，不写死某个 locale 的字面量，避免测试环境语言探测差异导致误判。
import i18n from '@/i18n';
import type { AuthFileItem } from '@/types';
import type { KeyStats } from '@/utils/usage';
import { AuthFileCard, type AuthFileCardProps } from './AuthFileCard';

const noop = () => {};

const baseKeyStats: KeyStats = { bySource: {}, byAuthIndex: {} };

function buildFile(overrides: Partial<AuthFileItem> = {}): AuthFileItem {
  return {
    name: 'account.json',
    type: 'qwen', // 非 OAuth 类型，避免额外渲染 canReauthenticate 分支干扰断言
    size: 1024,
    disabled: false,
    ...overrides,
  } as AuthFileItem;
}

function buildProps(fileOverrides: Partial<AuthFileItem> = {}): AuthFileCardProps {
  return {
    file: buildFile(fileOverrides),
    compact: false,
    selected: false,
    resolvedTheme: 'light',
    disableControls: false,
    deleting: null,
    statusUpdating: {},
    statusRefreshing: {},
    messageTesting: {},
    quotaFilterType: null,
    keyStats: baseKeyStats,
    statusBarCache: new Map(),
    onShowModels: noop,
    onDownload: noop,
    onOpenPrefixProxyEditor: noop,
    onDelete: noop,
    onReauthenticate: noop,
    onCopyReauthLink: noop,
    onCancelReauth: noop,
    onChangeReauthCallbackUrl: noop,
    onSubmitReauthCallback: noop,
    onToggleStatus: vi.fn(),
    onRefreshStatus: noop,
    onTestMessage: noop,
    onToggleSelect: noop,
  };
}

describe('AuthFileCard — 隔离徽标优先级 + 开关反映 disabled 意图（T18 ①，2026-07-31 反转后行为）', () => {
  it('quarantined-but-not-disabled account renders the quarantined badge, while the enable toggle stays checked + interactive (badge, not the toggle, carries quarantine state)', () => {
    render(
      <AuthFileCard
        {...buildProps({
          disabled: false,
          auto_quarantined: true,
          quarantine_reason: 'terminal_auth_failure',
          quarantined_at: '2026-01-01T00:00:00Z',
          status_message: 'a stale legacy message that must not win',
        })}
      />
    );

    const badge = screen.getByTestId('auth-file-quarantined-badge');
    expect(badge).toHaveTextContent(i18n.t('auth_files.health_status_quarantined'));

    // 开关只反映 file.disabled（此处 false），不再因 isQuarantined 改写 checked/disabled。
    const toggle = screen.getByTestId('auth-file-status-toggle');
    expect(toggle).toBeChecked();
    expect(toggle).not.toBeDisabled();
  });

  it('quarantine badge wins over disabled=true as well: badge stays "Quarantined" (not "Disabled"); toggle reflects disabled=true (unchecked) but remains interactive, not read-only', () => {
    render(
      <AuthFileCard
        {...buildProps({
          disabled: true,
          auto_quarantined: true,
          quarantine_reason: 'terminal_auth_failure',
        })}
      />
    );

    const badge = screen.getByTestId('auth-file-quarantined-badge');
    expect(badge).toHaveTextContent(i18n.t('auth_files.health_status_quarantined'));
    expect(badge).not.toHaveTextContent(i18n.t('auth_files.health_status_disabled'));

    // checked 由 disabled=true 决定（关），但 isQuarantined 不再强制只读。
    const toggle = screen.getByTestId('auth-file-status-toggle');
    expect(toggle).not.toBeChecked();
    expect(toggle).not.toBeDisabled();
  });

  it('healthy (non-quarantined, non-disabled) account keeps the toggle checked and interactive, with no quarantined badge', () => {
    render(<AuthFileCard {...buildProps({ disabled: false, auto_quarantined: false })} />);

    const toggle = screen.getByTestId('auth-file-status-toggle');
    expect(toggle).toBeChecked();
    expect(toggle).not.toBeDisabled();
    expect(screen.queryByTestId('auth-file-quarantined-badge')).not.toBeInTheDocument();
  });

  it('manually disabled (not quarantined) account shows the toggle off but still interactive — the toggle always reflects disabled intent and stays clickable; quarantine is surfaced independently via the badge, not by making the toggle read-only', () => {
    render(<AuthFileCard {...buildProps({ disabled: true, auto_quarantined: false })} />);

    const toggle = screen.getByTestId('auth-file-status-toggle');
    expect(toggle).not.toBeChecked();
    // disableControls=false、statusUpdating 为空 ⇒ 不应被强制只读。
    expect(toggle).not.toBeDisabled();
  });
});

describe('AuthFileCard — 异常原因常驻可见 + 最近失败次数（T18 ④）', () => {
  it('surfaces the quarantine reason as always-visible text (no hover required)', () => {
    render(
      <AuthFileCard
        {...buildProps({
          auto_quarantined: true,
          quarantine_reason: 'terminal_auth_failure',
        })}
      />
    );

    const reasonText = screen.getByTestId('auth-file-status-reason-text');
    const expectedReason = i18n.t('farm.accountHealth.quarantineReason_terminal_auth_failure');
    expect(reasonText).toHaveTextContent(
      i18n.t('auth_files.quarantine_reason_display', { reason: expectedReason })
    );
  });

  it('surfaces a non-quarantined status_message warning as always-visible text using the existing warning label', () => {
    render(
      <AuthFileCard
        {...buildProps({
          auto_quarantined: false,
          unavailable: true,
          status_message: 'invalid_grant: token revoked',
        })}
      />
    );

    const reasonText = screen.getByTestId('auth-file-status-reason-text');
    expect(reasonText).toHaveTextContent(
      `${i18n.t('auth_files.health_status_warning')}: invalid_grant: token revoked`
    );
    expect(screen.queryByTestId('auth-file-quarantined-badge')).not.toBeInTheDocument();
  });

  it('wires recent_requests into an always-visible recent-failure count, independent of status_message', () => {
    render(
      <AuthFileCard
        {...buildProps({
          auto_quarantined: false,
          status_message: '',
          recent_requests: [
            { success: 1, failed: 2 },
            { success: 0, failed: 3 },
          ],
        })}
      />
    );

    const failureCount = screen.getByTestId('auth-file-recent-failure-count');
    expect(failureCount).toHaveTextContent(
      i18n.t('auth_files.recent_failure_count', { failures: 5 })
    );
    // 没有隔离/状态文案时不应该渲染原因文本行，只渲染失败次数。
    expect(screen.queryByTestId('auth-file-status-reason-text')).not.toBeInTheDocument();
  });

  it('renders neither the reason row nor the failure count when the account is healthy with no recent failures', () => {
    render(
      <AuthFileCard
        {...buildProps({
          auto_quarantined: false,
          status_message: '',
          recent_requests: [{ success: 3, failed: 0 }],
        })}
      />
    );

    expect(screen.queryByTestId('auth-file-status-reason')).not.toBeInTheDocument();
  });
});
