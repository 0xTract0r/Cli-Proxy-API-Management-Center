/**
 * Quota management page - coordinates quota sections.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';
import { authFilesApi, configFileApi, parseCoreQuotaTimestamp, quotaApi } from '@/services/api';
import type { CoreQuotaRefreshPolicy, CoreQuotaSnapshotsResponse } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import { formatInUtc8 } from '@/utils/datetime';
import styles from './QuotaPage.module.scss';

type NormalizedQuotaRefreshPolicy = {
  returned: boolean;
  enabled?: boolean;
  intervalMinutes?: number;
  jitterMinutes?: number;
  startupCatchUp?: boolean;
  startupMaxStalenessMinutes?: number;
};

const readPolicyNumber = (
  policy: CoreQuotaRefreshPolicy | null,
  key: keyof CoreQuotaRefreshPolicy
): number | undefined => {
  const value = policy?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const secondsToDisplayMinutes = (seconds: number): number => {
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? minutes : Number(minutes.toFixed(2));
};

const readPolicyMinutes = (
  policy: CoreQuotaRefreshPolicy | null,
  secondsKey: keyof CoreQuotaRefreshPolicy,
  legacyMinutesKey: keyof CoreQuotaRefreshPolicy
): number | undefined => {
  const seconds = readPolicyNumber(policy, secondsKey);
  if (seconds !== undefined) return secondsToDisplayMinutes(seconds);
  return readPolicyNumber(policy, legacyMinutesKey);
};

const normalizeQuotaRefreshPolicy = (
  response: CoreQuotaSnapshotsResponse | null
): NormalizedQuotaRefreshPolicy => {
  const policy = response?.policy ?? response?.refresh_policy ?? null;
  if (!policy) return { returned: false };

  return {
    returned: true,
    enabled: typeof policy.enabled === 'boolean' ? policy.enabled : undefined,
    intervalMinutes: readPolicyMinutes(policy, 'interval_seconds', 'interval_minutes'),
    jitterMinutes: readPolicyMinutes(policy, 'jitter_seconds', 'jitter_minutes'),
    startupCatchUp:
      typeof policy.startup_catch_up === 'boolean' ? policy.startup_catch_up : undefined,
    startupMaxStalenessMinutes: readPolicyMinutes(
      policy,
      'startup_max_staleness_seconds',
      'startup_max_staleness_minutes'
    ),
  };
};

const pickQuotaTimestamp = (
  response: CoreQuotaSnapshotsResponse | null,
  field: 'last_refreshed_at' | 'next_refresh_at',
  mode: 'latest' | 'earliest'
): Date | null => {
  const topLevel = parseCoreQuotaTimestamp(response?.[field]);
  if (topLevel) return topLevel;
  const now = Date.now();

  const dates =
    response?.entries
      ?.filter((entry) => entry.disabled !== true)
      ?.map((entry) => parseCoreQuotaTimestamp(entry[field]))
      .filter((date): date is Date => Boolean(date))
      .filter((date) => field !== 'next_refresh_at' || date.getTime() > now) ?? [];

  if (dates.length === 0) return null;
  return dates.reduce((selected, date) =>
    mode === 'latest'
      ? date.getTime() > selected.getTime()
        ? date
        : selected
      : date.getTime() < selected.getTime()
        ? date
        : selected
  );
};

const formatRefreshTime = (value: Date | null) => {
  if (!value) return '';
  // 展示一律 UTC+8（Asia/Shanghai），不跟随浏览器本地时区。
  return formatInUtc8(value, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quotaRefreshSignal, setQuotaRefreshSignal] = useState(0);
  const [quotaSnapshotStatus, setQuotaSnapshotStatus] = useState<CoreQuotaSnapshotsResponse | null>(
    null
  );
  const [pageRefreshInFlight, setPageRefreshInFlight] = useState(false);
  const pageRefreshInFlightRef = useRef(false);

  const disableControls = connectionStatus !== 'connected';
  const quotaRefreshPolicy = useMemo(
    () => normalizeQuotaRefreshPolicy(quotaSnapshotStatus),
    [quotaSnapshotStatus]
  );
  const quotaLastRefreshedAt = useMemo(
    () => pickQuotaTimestamp(quotaSnapshotStatus, 'last_refreshed_at', 'latest'),
    [quotaSnapshotStatus]
  );
  const quotaNextRefreshAt = useMemo(
    () => pickQuotaTimestamp(quotaSnapshotStatus, 'next_refresh_at', 'earliest'),
    [quotaSnapshotStatus]
  );

  const formatMinutes = useCallback(
    (minutes: number | undefined) => {
      if (minutes === undefined) return t('quota_management.auto_refresh_default_policy');
      if (minutes === 1) return t('quota_management.auto_refresh_one_minute');
      if (minutes >= 60 && Number.isInteger(minutes / 60)) {
        return t('quota_management.auto_refresh_hours_with_minutes', {
          hours: minutes / 60,
          minutes,
        });
      }
      return t('quota_management.auto_refresh_minutes', { minutes });
    },
    [t]
  );

  const autoRefreshRows = useMemo(
    () => [
      {
        testId: 'quota-auto-refresh-policy',
        label: t('quota_management.auto_refresh_policy_label'),
        value: !quotaRefreshPolicy.returned
          ? t('quota_management.auto_refresh_policy_missing')
          : quotaRefreshPolicy.enabled === undefined
            ? t('quota_management.auto_refresh_default_policy')
            : quotaRefreshPolicy.enabled
              ? t('quota_management.auto_refresh_policy_enabled')
              : t('quota_management.auto_refresh_policy_disabled'),
      },
      {
        testId: 'quota-auto-refresh-interval',
        label: t('quota_management.auto_refresh_interval_label'),
        value: formatMinutes(quotaRefreshPolicy.intervalMinutes),
      },
      {
        testId: 'quota-auto-refresh-jitter',
        label: t('quota_management.auto_refresh_jitter_label'),
        value:
          quotaRefreshPolicy.jitterMinutes === undefined
            ? t('quota_management.auto_refresh_default_policy')
            : t('quota_management.auto_refresh_jitter_duration', {
                duration: formatMinutes(quotaRefreshPolicy.jitterMinutes),
              }),
      },
      {
        testId: 'quota-auto-refresh-startup',
        label: t('quota_management.auto_refresh_startup_label'),
        value:
          quotaRefreshPolicy.startupCatchUp === undefined
            ? t('quota_management.auto_refresh_default_policy')
            : quotaRefreshPolicy.startupCatchUp
              ? t('quota_management.auto_refresh_startup_enabled')
              : t('quota_management.auto_refresh_startup_disabled'),
      },
      {
        testId: 'quota-auto-refresh-startup-max-staleness',
        label: t('quota_management.auto_refresh_startup_max_staleness_label'),
        value: formatMinutes(quotaRefreshPolicy.startupMaxStalenessMinutes),
      },
      {
        testId: 'quota-auto-refresh-last',
        label: t('quota_management.auto_refresh_last_label'),
        value: quotaLastRefreshedAt
          ? formatRefreshTime(quotaLastRefreshedAt)
          : t('quota_management.auto_refresh_not_refreshed'),
      },
      {
        testId: 'quota-auto-refresh-next',
        label: t('quota_management.auto_refresh_next_label'),
        value: quotaNextRefreshAt
          ? formatRefreshTime(quotaNextRefreshAt)
          : t('quota_management.auto_refresh_waiting_schedule'),
      },
    ],
    [formatMinutes, quotaLastRefreshedAt, quotaNextRefreshAt, quotaRefreshPolicy, t]
  );

  const loadConfig = useCallback(async () => {
    try {
      await configFileApi.fetchConfigYaml();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError((prev) => prev || errorMessage);
    }
  }, [t]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadQuotaSnapshotStatus = useCallback(async () => {
    try {
      const data = await quotaApi.getSnapshots();
      setQuotaSnapshotStatus(data);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError((prev) => prev || errorMessage);
    }
  }, [t]);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadFiles(), loadQuotaSnapshotStatus()]);
  }, [loadConfig, loadFiles, loadQuotaSnapshotStatus]);

  useHeaderRefresh(handleHeaderRefresh);

  const refreshPageQuota = useCallback(async () => {
    if (disableControls || pageRefreshInFlightRef.current) return;

    pageRefreshInFlightRef.current = true;
    setPageRefreshInFlight(true);
    setError('');
    try {
      const [, , refreshedStatus] = await Promise.all([
        loadConfig(),
        loadFiles(),
        quotaApi.refresh({}),
      ]);
      setQuotaSnapshotStatus(refreshedStatus);
      setQuotaRefreshSignal((value) => value + 1);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      pageRefreshInFlightRef.current = false;
      setPageRefreshInFlight(false);
    }
  }, [disableControls, loadConfig, loadFiles, t]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadFiles(), loadConfig(), loadQuotaSnapshotStatus()]).finally(() => {
      if (!cancelled) {
        setQuotaRefreshSignal((value) => value + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadFiles, loadConfig, loadQuotaSnapshotStatus]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
        <p className={styles.description}>{t('quota_management.description')}</p>
      </div>

      <div className={styles.autoRefreshPanel} data-testid="quota-auto-refresh-panel">
        <div className={styles.autoRefreshText}>
          <div className={styles.autoRefreshTitle}>{t('quota_management.auto_refresh_title')}</div>
          <div className={styles.autoRefreshStatus} data-testid="quota-auto-refresh-status">
            {t('quota_management.auto_refresh_status_hint')}
          </div>
          <div className={styles.autoRefreshMetaGrid}>
            {autoRefreshRows.map((row) => (
              <div key={row.testId} className={styles.autoRefreshMetaItem} data-testid={row.testId}>
                <span className={styles.autoRefreshMetaLabel}>{row.label}</span>
                <span className={styles.autoRefreshMetaValue}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.autoRefreshControls}>
          <Link
            data-testid="quota-auto-refresh-config-link"
            className={styles.autoRefreshButton}
            to="/config?section=quota"
          >
            {t('quota_management.auto_refresh_configure')}
          </Link>
          <button
            data-testid="quota-refresh-now"
            className={styles.autoRefreshButton}
            type="button"
            disabled={disableControls || pageRefreshInFlight}
            onClick={() => void refreshPageQuota()}
          >
            {pageRefreshInFlight
              ? t('quota_management.auto_refresh_running')
              : t('quota_management.refresh_now')}
          </button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <QuotaSection
        config={CLAUDE_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        quotaRefreshSignal={quotaRefreshSignal}
      />
      <QuotaSection
        config={ANTIGRAVITY_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
      <QuotaSection
        config={CODEX_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        quotaRefreshSignal={quotaRefreshSignal}
      />
      <QuotaSection
        config={XAI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
      <QuotaSection
        config={GEMINI_CLI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
      <QuotaSection
        config={KIMI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
    </div>
  );
}
