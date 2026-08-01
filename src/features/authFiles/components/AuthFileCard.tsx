import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconBot,
  IconDownload,
  IconKey,
  IconModelCluster,
  IconRefreshCw,
  IconSettings,
  IconTrash2,
} from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import type { AuthFileItem } from '@/types';
import { resolveAuthProvider } from '@/utils/quota';
import { formatDateTimeUtc8 } from '@/utils/datetime';
import { calculateStatusBarData, normalizeAuthIndex, type KeyStats } from '@/utils/usage';
import { formatFileSize } from '@/utils/format';
import {
  formatModified,
  getAuthFileRecentFailureCount,
  getAuthFileStatusMessage,
  getTypeColor,
  getTypeLabel,
  hasAuthFileStatusWarning,
  isAuthFileAutoQuarantined,
  isAuthFileReauthRequired,
  isAuthFileMissingProxyUrl,
  isRuntimeOnlyAuthFile,
  parsePriorityValue,
  QUOTA_PROVIDER_TYPES,
  resolveAuthFileStats,
  getAuthFileIcon,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import {
  resolveAuthFileOAuthProvider,
  supportsAuthFileReauthCallback,
  type AuthFileReauthState,
} from '@/features/authFiles/hooks/useAuthFilesReauth';
import type { AuthFileStatusBarData } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import { AuthFilesReauthHistoryPanel } from '@/features/authFiles/components/AuthFilesReauthHistoryPanel';
import { AuthFilesStatusHistoryPanel } from '@/features/authFiles/components/AuthFilesStatusHistoryPanel';
import { AuthFileQuotaSection } from '@/features/authFiles/components/AuthFileQuotaSection';
import styles from '@/pages/AuthFilesPage.module.scss';

export type AuthFileCardProps = {
  file: AuthFileItem;
  compact: boolean;
  selected: boolean;
  resolvedTheme: ResolvedTheme;
  disableControls: boolean;
  deleting: string | null;
  statusUpdating: Record<string, boolean>;
  statusRefreshing: Record<string, boolean>;
  messageTesting: Record<string, boolean>;
  reauthState?: AuthFileReauthState;
  reauthHistoryReloadKey?: number;
  statusHistoryReloadKey?: number;
  quotaFilterType: QuotaProviderType | null;
  keyStats: KeyStats;
  statusBarCache: Map<string, AuthFileStatusBarData>;
  onShowModels: (file: AuthFileItem) => void;
  onDownload: (name: string) => void;
  onOpenPrefixProxyEditor: (file: AuthFileItem) => void;
  onDelete: (name: string) => void;
  onReauthenticate: (file: AuthFileItem) => void;
  onCopyReauthLink: (fileName: string) => void;
  onCancelReauth: (fileName: string) => void;
  onChangeReauthCallbackUrl: (fileName: string, callbackUrl: string) => void;
  onSubmitReauthCallback: (fileName: string) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onRefreshStatus: (file: AuthFileItem) => void;
  onTestMessage: (file: AuthFileItem) => void;
  onToggleSelect: (name: string) => void;
};

const resolveQuotaType = (file: AuthFileItem): QuotaProviderType | null => {
  const provider = resolveAuthProvider(file);
  if (!QUOTA_PROVIDER_TYPES.has(provider as QuotaProviderType)) return null;
  return provider as QuotaProviderType;
};

type StatusMarkerVariant = 'warning' | 'pending' | 'error' | 'cyber';

function StatusMarker({
  variant,
  tooltip,
  badge,
}: {
  variant: StatusMarkerVariant;
  tooltip: string;
  badge?: string | number;
}) {
  const variantClass =
    variant === 'warning'
      ? styles.statusMarkerWarning
      : variant === 'pending'
        ? styles.statusMarkerPending
        : variant === 'cyber'
          ? styles.statusMarkerCyber
          : styles.statusMarkerError;

  // badge 显式给值（非空字符串、非 0）才渲染数字徽标，否则回退到空心点视觉。
  const hasBadge = badge !== undefined && badge !== '' && badge !== 0;

  return (
    <span
      className={`${styles.statusMarker} ${variantClass}`}
      aria-label={tooltip}
      tabIndex={0}
      data-testid={`auth-file-status-marker-${variant}`}
    >
      {hasBadge ? (
        <span className={styles.statusMarkerBadge}>{badge}</span>
      ) : (
        <span className={styles.statusMarkerDot} />
      )}
      <span
        className={styles.statusMarkerTooltip}
        role="tooltip"
        data-testid={`auth-file-status-tooltip-${variant}`}
      >
        {tooltip}
      </span>
    </span>
  );
}

export function AuthFileCard(props: AuthFileCardProps) {
  const { t } = useTranslation();
  const {
    file,
    compact,
    selected,
    resolvedTheme,
    disableControls,
    deleting,
    statusUpdating,
    statusRefreshing,
    messageTesting,
    reauthState,
    reauthHistoryReloadKey = 0,
    statusHistoryReloadKey = 0,
    quotaFilterType,
    keyStats,
    statusBarCache,
    onShowModels,
    onDownload,
    onOpenPrefixProxyEditor,
    onDelete,
    onReauthenticate,
    onCopyReauthLink,
    onCancelReauth,
    onChangeReauthCallbackUrl,
    onSubmitReauthCallback,
    onToggleStatus,
    onRefreshStatus,
    onTestMessage,
    onToggleSelect,
  } = props;

  const fileStats = resolveAuthFileStats(file, keyStats);
  const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
  const isAistudio = (file.type || '').toLowerCase() === 'aistudio';
  const showModelsButton = !isRuntimeOnly || isAistudio;
  const canTestMessage = !isRuntimeOnly && !file.disabled;
  const typeColor = getTypeColor(file.type || 'unknown', resolvedTheme);
  const typeLabel = getTypeLabel(t, file.type || 'unknown');
  const providerIcon = getAuthFileIcon(file.type || 'unknown', resolvedTheme);
  const oauthProvider = resolveAuthFileOAuthProvider(file);
  const canReauthenticate = Boolean(oauthProvider) && !isRuntimeOnly;
  const reauthInProgress = reauthState?.status === 'starting' || reauthState?.status === 'polling';
  const supportsReauthCallback =
    reauthState?.status === 'polling' && supportsAuthFileReauthCallback(reauthState.provider);

  const quotaType =
    quotaFilterType && resolveQuotaType(file) === quotaFilterType ? quotaFilterType : null;

  const showQuotaLayout = Boolean(quotaType) && !isRuntimeOnly && !compact;

  const providerCardClass =
    quotaType === 'antigravity'
      ? styles.antigravityCard
      : quotaType === 'claude'
        ? styles.claudeCard
        : quotaType === 'codex'
          ? styles.codexCard
          : quotaType === 'gemini-cli'
            ? styles.geminiCliCard
            : quotaType === 'kimi'
              ? styles.kimiCard
              : '';

  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndexKey = normalizeAuthIndex(rawAuthIndex);
  const statusData =
    (authIndexKey && statusBarCache.get(authIndexKey)) || calculateStatusBarData([]);
  const rawStatusMessage = getAuthFileStatusMessage(file);
  const hasStatusWarning = hasAuthFileStatusWarning(file);
  // 自动隔离态（T3 telemetry-farm-ux-hardening 对齐）：core 权威隔离位，独立于
  // status/unavailable 判断，避免"已隔离但显健康/启用"假绿——判定口径与农场页
  // FarmAccountsPanel 的 isAutoQuarantined 一致。
  const isQuarantined = isAuthFileAutoQuarantined(file);
  // 「需重新认证」纵深防御信号（reauth_url / reauth_required）：即便账号未被隔离、
  // unavailable 尚未置 true，只要带 reauth 信号也必须显式呈现「需重新认证」而非假绿。
  // 隔离态优先级更高（隔离账号本就带 reauth_url，先命中 isQuarantined 显示「已隔离」）。
  const isReauthRequired = isAuthFileReauthRequired(file);
  // 隔离原因/时间 tooltip：复用农场页 farm.accountHealth.* 的既有 i18n 键
  // （reason 枚举文案 + tooltip 拼句），同一份隔离说明不在两个 feature 各自
  // 重复维护一份文案。
  const quarantineReasonLabel = file.quarantine_reason
    ? t(`farm.accountHealth.quarantineReason_${file.quarantine_reason}`, {
        defaultValue: file.quarantine_reason,
      })
    : t('farm.accountHealth.quarantineReasonUnknown', { defaultValue: 'unknown reason' });
  const quarantineAtLabel = file.quarantined_at
    ? formatDateTimeUtc8(file.quarantined_at)
    : t('farm.accountHealth.quarantineTimeUnknown', { defaultValue: 'unknown time' });
  const quarantineTooltip = isQuarantined
    ? t('farm.accountHealth.quarantineTooltip', {
        reason: quarantineReasonLabel,
        at: quarantineAtLabel,
        defaultValue:
          'Auto-quarantined: {{reason}} · {{at}}. Please re-authenticate to restore this account.',
      })
    : undefined;
  const canRefreshStatus = canReauthenticate && hasStatusWarning && !file.disabled;
  const canViewStatusHistory = canReauthenticate;
  const waitingStatusTitle = t('auth_files.reauth_waiting', {
    defaultValue: 'Waiting for re-authentication to complete',
  });
  const fileStatusMarkerTitle =
    rawStatusMessage && hasStatusWarning
      ? `${t('auth_files.health_status_warning')}: ${rawStatusMessage}`
      : '';
  // 异常原因常驻可见（T18「账号健康显示如实化」④）：此前隔离原因/status_message
  // 只在 StatusMarker hover tooltip 里才看得到，不打开卡片悬浮就看不到"为什么"。
  // 隔离优先于普通 status_message（与上面 stateLabel/stateBadgeClass 的隔离优先级
  // 判定口径一致），避免同时展示两条冲突文案。
  const statusReasonLine = isQuarantined
    ? t('auth_files.quarantine_reason_display', {
        reason: quarantineReasonLabel,
        defaultValue: 'Quarantine reason: {{reason}}',
      })
    : fileStatusMarkerTitle;
  // 最近失败次数（recent_requests 分桶汇总，数据此前已投影但未接线展示）。
  const recentFailureCount = getAuthFileRecentFailureCount(file);
  const recentFailureCountLabel =
    recentFailureCount > 0
      ? t('auth_files.recent_failure_count', {
          failures: recentFailureCount,
          defaultValue: 'Recent failures: {{failures}}',
        })
      : '';
  const reauthPollingTitle = reauthState?.error
    ? `${waitingStatusTitle}\n${reauthState.error}`
    : waitingStatusTitle;
  const reauthErrorTitle = reauthState?.error
    ? `${t('auth_files.reauth_failed_badge', { defaultValue: 'Re-authentication failed' })}: ${reauthState.error}`
    : '';

  // Cyber policy alert marker: surface when upstream has flagged this auth.
  // 使用 StatusMarker variant="cyber"（橙色），与 health warning（红色）区分。
  const cyberPolicyFlagCount =
    typeof file.cyber_policy_flag_count === 'number' && file.cyber_policy_flag_count > 0
      ? file.cyber_policy_flag_count
      : 0;
  const lastCyberPolicyDisplay = (() => {
    const raw = file.last_cyber_policy_at;
    if (typeof raw !== 'string' || raw.trim() === '') return '';
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : formatDateTimeUtc8(parsed);
  })();
  const cyberPolicyMarkerTitle =
    cyberPolicyFlagCount > 0
      ? lastCyberPolicyDisplay
        ? t('auth_files.cyber_policy_marker_with_last', {
            count: cyberPolicyFlagCount,
            last: lastCyberPolicyDisplay,
          })
        : t('auth_files.cyber_policy_marker', { count: cyberPolicyFlagCount })
      : '';

  // 缺失 proxy_url（住宅代理）告警：core#26/#27 把空 proxy_url 账号标为不可用并下发 warnings。
  // 卡片用醒目橙色标记 + tooltip 提示，让用户一眼看出哪个号缺 proxy 需要补填。
  const missingProxyUrl = isAuthFileMissingProxyUrl(file);
  const missingProxyMarkerTitle = missingProxyUrl
    ? t('auth_files.proxy_url_missing_marker', {
        defaultValue:
          'Missing proxy_url: this account is unavailable until a residential proxy is set, otherwise requests would expose your real IP.',
      })
    : '';

  const priorityValue = parsePriorityValue(file.priority ?? file['priority']);
  const noteValue = typeof file.note === 'string' ? file.note.trim() : '';
  // 隔离优先级：仅次于「虚拟认证文件」，高于 disabled/健康/启用兜底——
  // auto_quarantined 是 core 权威终态信号（终态认证失败等不可重试错误），
  // 比 operator 手动 disabled 或默认「启用」兜底更具体、更需要 operator
  // 立即处理，不应该被其中任何一个掩盖成假绿。
  const stateLabel = isRuntimeOnly
    ? t('auth_files.type_virtual') || '虚拟认证文件'
    : isQuarantined
      ? t('auth_files.health_status_quarantined', { defaultValue: 'Quarantined' })
      : isReauthRequired
        ? t('auth_files.health_status_reauth_required', {
            defaultValue: 'Re-authentication required',
          })
        : file.disabled
          ? t('auth_files.health_status_disabled')
          : hasStatusWarning
            ? t('auth_files.health_status_warning')
            : rawStatusMessage
              ? t('auth_files.health_status_healthy')
              : t('auth_files.status_toggle_label');
  const stateBadgeClass = isRuntimeOnly
    ? styles.stateBadgeVirtual
    : isQuarantined
      ? styles.stateBadgeWarning
      : isReauthRequired
        ? styles.stateBadgeWarning
        : file.disabled
          ? styles.stateBadgeDisabled
          : hasStatusWarning
            ? styles.stateBadgeWarning
            : styles.stateBadgeActive;
  const modelsButtonTitle = t('auth_files.models_button', { defaultValue: '模型' });
  const refreshStatusButtonTitle = t('auth_files.status_refresh_button', {
    defaultValue: 'Refresh status',
  });
  const testMessageButtonTitle = t('auth_files.test_message_button', {
    defaultValue: 'Test message',
  });
  const reauthButtonTitle = reauthInProgress
    ? t('auth_files.reauth_waiting', {
        defaultValue: 'Waiting for re-authentication to complete',
      })
    : t('auth_files.reauth_button', { defaultValue: 'Re-authenticate' });

  return (
    <div
      className={`${styles.fileCard} ${compact ? styles.fileCardCompact : ''} ${providerCardClass} ${selected ? styles.fileCardSelected : ''} ${file.disabled ? styles.fileCardDisabled : ''}`}
      data-testid="auth-file-card"
    >
      <div className={styles.fileCardLayout}>
        <div className={styles.fileCardMain}>
          <div className={styles.cardHeader}>
            {!isRuntimeOnly && (
              <SelectionCheckbox
                checked={selected}
                onChange={() => onToggleSelect(file.name)}
                className={styles.cardSelection}
                aria-label={
                  selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')
                }
                title={selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')}
              />
            )}
            <div
              className={styles.providerAvatar}
              style={{
                backgroundColor: typeColor.bg,
                color: typeColor.text,
                ...(typeColor.border ? { border: typeColor.border } : {}),
              }}
            >
              {providerIcon ? (
                <img src={providerIcon} alt="" className={styles.providerAvatarImage} />
              ) : (
                <span className={styles.providerAvatarFallback}>
                  {typeLabel.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <div className={styles.cardHeaderContent}>
              <div className={styles.cardBadgeRow}>
                <span
                  className={styles.typeBadge}
                  style={{
                    backgroundColor: typeColor.bg,
                    color: typeColor.text,
                    ...(typeColor.border ? { border: typeColor.border } : {}),
                  }}
                >
                  {typeLabel}
                </span>
                <span
                  className={`${styles.stateBadge} ${stateBadgeClass}`}
                  title={quarantineTooltip || fileStatusMarkerTitle || undefined}
                  data-testid={
                    isQuarantined
                      ? 'auth-file-quarantined-badge'
                      : isReauthRequired
                        ? 'auth-file-reauth-required-badge'
                        : undefined
                  }
                >
                  {stateLabel}
                </span>
                {missingProxyMarkerTitle && (
                  <span
                    className={`${styles.stateBadge} ${styles.stateBadgeMissingProxy}`}
                    title={missingProxyMarkerTitle}
                    data-testid="auth-file-missing-proxy-badge"
                  >
                    {t('auth_files.proxy_url_missing_badge', {
                      defaultValue: 'Missing proxy',
                    })}
                  </span>
                )}
                {(fileStatusMarkerTitle ||
                  missingProxyMarkerTitle ||
                  cyberPolicyMarkerTitle ||
                  reauthState?.status === 'polling' ||
                  (reauthState?.status === 'error' && reauthErrorTitle)) && (
                  <span className={styles.cardStatusMarkers}>
                    {missingProxyMarkerTitle && (
                      <StatusMarker variant="cyber" tooltip={missingProxyMarkerTitle} />
                    )}
                    {fileStatusMarkerTitle && (
                      <StatusMarker variant="warning" tooltip={fileStatusMarkerTitle} />
                    )}
                    {cyberPolicyMarkerTitle && (
                      <StatusMarker
                        variant="cyber"
                        tooltip={cyberPolicyMarkerTitle}
                        badge={cyberPolicyFlagCount}
                      />
                    )}
                    {reauthState?.status === 'polling' && (
                      <StatusMarker variant="pending" tooltip={reauthPollingTitle} />
                    )}
                    {reauthState?.status === 'error' && reauthErrorTitle && (
                      <StatusMarker variant="error" tooltip={reauthErrorTitle} />
                    )}
                  </span>
                )}
                {noteValue && (
                  <span className={styles.noteBadge} title={noteValue}>
                    <span className={styles.noteBadgeLabel}>{t('auth_files.note_display')}</span>
                    <span className={styles.noteBadgeValue}>{noteValue}</span>
                  </span>
                )}
              </div>
              <span className={styles.fileName} title={file.name}>
                {file.name}
              </span>
            </div>
          </div>

          <div className={`${styles.cardMeta} ${compact ? styles.cardMetaCompact : ''}`}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>{t('auth_files.file_size')}</span>
              <span className={styles.metaValue}>
                {file.size ? formatFileSize(file.size) : '-'}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>{t('auth_files.file_modified')}</span>
              <span className={styles.metaValue}>{formatModified(file)}</span>
            </div>
            {priorityValue !== undefined && (
              <div className={`${styles.metaItem} ${styles.priorityBadge}`}>
                <span className={styles.metaLabel}>{t('auth_files.priority_display')}</span>
                <span className={`${styles.metaValue} ${styles.priorityValue}`}>
                  {priorityValue}
                </span>
              </div>
            )}
            {canReauthenticate && (
              <div className={styles.cardMetaAction}>
                <div className={styles.cardMetaActionList}>
                  <AuthFilesReauthHistoryPanel file={file} reloadKey={reauthHistoryReloadKey} />
                  {canViewStatusHistory && (
                    <AuthFilesStatusHistoryPanel file={file} reloadKey={statusHistoryReloadKey} />
                  )}
                </div>
              </div>
            )}
          </div>

          {reauthState?.status === 'polling' && (
            <>
              <div className={styles.reauthActionRow}>
                {reauthState.url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.reauthActionButton}
                    onClick={() => onCopyReauthLink(file.name)}
                    disabled={disableControls}
                  >
                    {t('auth_files.reauth_copy_link', { defaultValue: 'Copy link' })}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.reauthActionButton}
                  onClick={() => onCancelReauth(file.name)}
                  disabled={disableControls}
                >
                  {t('auth_files.reauth_cancel', { defaultValue: 'Cancel' })}
                </Button>
              </div>
            </>
          )}

          {reauthState?.status === 'error' && reauthState.error && (
            <div className={styles.reauthPersistentError} role="alert">
              <span className={styles.reauthPersistentErrorTitle}>
                {t('auth_files.reauth_failed_badge', {
                  defaultValue: 'Re-authentication failed',
                })}
              </span>
              <span className={styles.reauthPersistentErrorMessage}>{reauthState.error}</span>
            </div>
          )}

          {supportsReauthCallback && (
            <div className={styles.reauthCallbackSection}>
              <Input
                label={t('auth_login.oauth_callback_label')}
                hint={t('auth_login.oauth_callback_hint')}
                value={reauthState.callbackUrl || ''}
                onChange={(e) => onChangeReauthCallbackUrl(file.name, e.target.value)}
                placeholder={t('auth_login.oauth_callback_placeholder')}
                disabled={disableControls || Boolean(reauthState.callbackSubmitting)}
                error={
                  reauthState.callbackStatus === 'error' ? reauthState.callbackError : undefined
                }
              />
              <div className={styles.reauthCallbackActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.reauthActionButton}
                  onClick={() => onSubmitReauthCallback(file.name)}
                  loading={Boolean(reauthState.callbackSubmitting)}
                  disabled={disableControls}
                >
                  {t('auth_login.oauth_callback_button')}
                </Button>
                {reauthState.callbackStatus === 'success' && (
                  <span className={styles.reauthCallbackSuccess}>
                    {t('auth_login.oauth_callback_status_success')}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className={`${styles.cardInsights} ${compact ? styles.cardInsightsCompact : ''}`}>
            <div className={`${styles.cardStats} ${compact ? styles.cardStatsCompact : ''}`}>
              <div className={`${styles.statPill} ${styles.statSuccess}`}>
                <span className={styles.statLabel}>{t('stats.success')}</span>
                <span className={styles.statValue}>{fileStats.success}</span>
              </div>
              <div className={`${styles.statPill} ${styles.statFailure}`}>
                <span className={styles.statLabel}>{t('stats.failure')}</span>
                <span className={styles.statValue}>{fileStats.failure}</span>
              </div>
            </div>

            <div className={`${styles.statusPanel} ${compact ? styles.statusPanelCompact : ''}`}>
              <div className={styles.statusPanelLabel}>
                <span>{t('auth_files.health_status_label')}</span>
              </div>
              <ProviderStatusBar statusData={statusData} styles={styles} />
            </div>

            {(statusReasonLine || recentFailureCountLabel) && (
              <div className={styles.statusReasonPanel} data-testid="auth-file-status-reason">
                {statusReasonLine && (
                  <span
                    className={`${styles.statusReasonText} ${isQuarantined ? styles.statusReasonTextQuarantined : ''}`}
                    data-testid="auth-file-status-reason-text"
                  >
                    {statusReasonLine}
                  </span>
                )}
                {recentFailureCountLabel && (
                  <span
                    className={styles.statusReasonFailureCount}
                    data-testid="auth-file-recent-failure-count"
                  >
                    {recentFailureCountLabel}
                  </span>
                )}
              </div>
            )}

            {showQuotaLayout && quotaType && (
              <AuthFileQuotaSection
                file={file}
                quotaType={quotaType}
                disableControls={disableControls}
              />
            )}
          </div>

          <div className={styles.cardActions}>
            <div className={styles.cardActionsMain}>
              <div className={styles.cardPrimaryActions}>
                {showModelsButton && (
                  <div className={styles.primaryActionSlot}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onShowModels(file)}
                      className={`${styles.iconButton} ${styles.compactPrimaryActionButton} ${styles.modelsCompactActionButton}`}
                      title={modelsButtonTitle}
                      aria-label={modelsButtonTitle}
                      data-testid="auth-file-action-models"
                      disabled={disableControls}
                    >
                      <IconModelCluster className={styles.actionIcon} size={16} />
                    </Button>
                    <span className={styles.primaryActionCaption} aria-hidden="true">
                      {modelsButtonTitle}
                    </span>
                  </div>
                )}
                {canRefreshStatus && (
                  <div className={styles.primaryActionSlot}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onRefreshStatus(file)}
                      className={`${styles.iconButton} ${styles.compactPrimaryActionButton} ${styles.refreshCompactActionButton}`}
                      title={refreshStatusButtonTitle}
                      aria-label={refreshStatusButtonTitle}
                      data-testid="auth-file-action-refresh"
                      disabled={
                        disableControls || reauthInProgress || statusRefreshing[file.name] === true
                      }
                    >
                      <IconRefreshCw className={styles.actionIcon} size={16} />
                    </Button>
                    <span className={styles.primaryActionCaption} aria-hidden="true">
                      {refreshStatusButtonTitle}
                    </span>
                  </div>
                )}
                {canTestMessage && (
                  <div className={styles.primaryActionSlot}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onTestMessage(file)}
                      className={`${styles.iconButton} ${styles.compactPrimaryActionButton}`}
                      title={testMessageButtonTitle}
                      aria-label={testMessageButtonTitle}
                      data-testid="auth-file-action-test-message"
                      disabled={
                        disableControls ||
                        reauthInProgress ||
                        statusRefreshing[file.name] === true ||
                        messageTesting[file.name] === true
                      }
                    >
                      {messageTesting[file.name] === true ? (
                        <LoadingSpinner size={16} />
                      ) : (
                        <IconBot className={styles.actionIcon} size={16} />
                      )}
                    </Button>
                    <span className={styles.primaryActionCaption} aria-hidden="true">
                      {testMessageButtonTitle}
                    </span>
                  </div>
                )}
                {canReauthenticate && (
                  <div className={styles.primaryActionSlot}>
                    <Button
                      variant={hasStatusWarning ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => onReauthenticate(file)}
                      className={`${styles.iconButton} ${styles.compactPrimaryActionButton} ${styles.reauthCompactActionButton}`}
                      title={reauthButtonTitle}
                      aria-label={reauthButtonTitle}
                      data-testid="auth-file-action-reauth"
                      disabled={disableControls || reauthInProgress}
                    >
                      <IconKey className={styles.actionIcon} size={16} />
                    </Button>
                    <span className={styles.primaryActionCaption} aria-hidden="true">
                      {reauthButtonTitle}
                    </span>
                  </div>
                )}
              </div>
              <div className={styles.cardPrimaryActionsHint} aria-hidden="true">
                {[
                  modelsButtonTitle,
                  canTestMessage ? testMessageButtonTitle : null,
                  canRefreshStatus ? refreshStatusButtonTitle : null,
                  canReauthenticate ? reauthButtonTitle : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {!isRuntimeOnly && (
                <div className={styles.cardUtilityActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onDownload(file.name)}
                    className={styles.iconButton}
                    title={t('auth_files.download_button')}
                    disabled={disableControls}
                  >
                    <IconDownload className={styles.actionIcon} size={16} />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenPrefixProxyEditor(file)}
                    className={styles.iconButton}
                    data-testid="auth-file-action-account-settings"
                    title={t('auth_files.prefix_proxy_button')}
                    disabled={disableControls}
                  >
                    <IconSettings className={styles.actionIcon} size={16} />
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => onDelete(file.name)}
                    className={styles.iconButton}
                    title={t('auth_files.delete_button')}
                    disabled={disableControls || deleting === file.name}
                  >
                    {deleting === file.name ? (
                      <LoadingSpinner size={14} />
                    ) : (
                      <IconTrash2 className={styles.actionIcon} size={16} />
                    )}
                  </Button>
                </div>
              )}
            </div>
            {!isRuntimeOnly && (
              <div
                className={styles.statusToggle}
                title={isQuarantined ? quarantineTooltip : undefined}
              >
                <span className={styles.statusToggleLabel}>
                  {t('auth_files.status_toggle_label')}
                </span>
                {/*
                  开关回归 operator 意图（启用/停用），始终可点：checked/disabled
                  只反映 file.disabled 本身，不再因 isQuarantined 改写展示态或转
                  只读。隔离状态改由上方「已隔离」徽标（quarantineTooltip）独立
                  呈现，不再借助本开关的假「关」态表达。依赖 core 侧修复隔离锁
                  误清问题（隔离锁只应在账号真正恢复/reauth 成功时解除，停用一
                  个已被隔离的账号不应连带清掉隔离标记）——该修复状态以 core 侧
                  实现与验收为准，见 openspec/changes/telemetry-device-farm/tasks.md
                  (task #20 / P8.5)，本改动本身未重新验证该项。hover 仍显示隔离
                  提示，帮助 operator 理解为什么该账号当前不可用。
                */}
                <ToggleSwitch
                  ariaLabel={t('auth_files.status_toggle_label')}
                  checked={!file.disabled}
                  disabled={disableControls || statusUpdating[file.name] === true}
                  onChange={(value) => onToggleStatus(file, value)}
                  testId="auth-file-status-toggle"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
