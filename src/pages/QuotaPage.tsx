/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';
import { authFilesApi, configFileApi } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import styles from './QuotaPage.module.scss';

const AUTO_REFRESH_ENABLED_KEY = 'quotaAutoRefreshEnabled';
const AUTO_REFRESH_INTERVAL_KEY = 'quotaAutoRefreshIntervalMs';
const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 60_000;
const AUTO_REFRESH_INTERVAL_OPTIONS = [60_000, 300_000, 900_000];

const readStoredAutoRefreshEnabled = () => {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage.getItem(AUTO_REFRESH_ENABLED_KEY);
  if (stored === null) return true;
  return stored === 'true';
};

const readStoredAutoRefreshInterval = () => {
  if (typeof window === 'undefined') return DEFAULT_AUTO_REFRESH_INTERVAL_MS;
  const stored = Number(window.localStorage.getItem(AUTO_REFRESH_INTERVAL_KEY));
  if (AUTO_REFRESH_INTERVAL_OPTIONS.includes(stored)) return stored;
  return DEFAULT_AUTO_REFRESH_INTERVAL_MS;
};

const formatRefreshTime = (value: Date | null) => {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(value);
};

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quotaRefreshSignal, setQuotaRefreshSignal] = useState(0);
  const [pageRefreshInFlight, setPageRefreshInFlight] = useState(false);
  const [lastPageRefreshAt, setLastPageRefreshAt] = useState<Date | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(readStoredAutoRefreshEnabled);
  const [autoRefreshIntervalMs, setAutoRefreshIntervalMs] = useState(
    readStoredAutoRefreshInterval
  );
  const pageRefreshInFlightRef = useRef(false);

  const disableControls = connectionStatus !== 'connected';

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

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadFiles()]);
  }, [loadConfig, loadFiles]);

  useHeaderRefresh(handleHeaderRefresh);

  const refreshPageQuota = useCallback(async () => {
    if (disableControls || pageRefreshInFlightRef.current) return;

    pageRefreshInFlightRef.current = true;
    setPageRefreshInFlight(true);
    try {
      await handleHeaderRefresh();
      setQuotaRefreshSignal((value) => value + 1);
      setLastPageRefreshAt(new Date());
    } finally {
      pageRefreshInFlightRef.current = false;
      setPageRefreshInFlight(false);
    }
  }, [disableControls, handleHeaderRefresh]);

  useEffect(() => {
    loadFiles();
    loadConfig();
  }, [loadFiles, loadConfig]);

  useEffect(() => {
    window.localStorage.setItem(AUTO_REFRESH_ENABLED_KEY, String(autoRefreshEnabled));
  }, [autoRefreshEnabled]);

  useEffect(() => {
    window.localStorage.setItem(AUTO_REFRESH_INTERVAL_KEY, String(autoRefreshIntervalMs));
  }, [autoRefreshIntervalMs]);

  useEffect(() => {
    if (!autoRefreshEnabled || disableControls) return;

    void refreshPageQuota();
    const timer = window.setInterval(() => {
      void refreshPageQuota();
    }, autoRefreshIntervalMs);

    return () => window.clearInterval(timer);
  }, [autoRefreshEnabled, autoRefreshIntervalMs, disableControls, refreshPageQuota]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
        <p className={styles.description}>{t('quota_management.description')}</p>
      </div>

      <div className={styles.autoRefreshPanel} data-testid="quota-auto-refresh-panel">
        <div className={styles.autoRefreshText}>
          <div className={styles.autoRefreshTitle}>
            {t('quota_management.auto_refresh_title')}
          </div>
          <div className={styles.autoRefreshStatus} data-testid="quota-auto-refresh-status">
            {lastPageRefreshAt
              ? t('quota_management.auto_refresh_last_run', {
                  time: formatRefreshTime(lastPageRefreshAt)
                })
              : t('quota_management.auto_refresh_pending')}
          </div>
        </div>
        <div className={styles.autoRefreshControls}>
          <label className={styles.autoRefreshToggle}>
            <input
              data-testid="quota-auto-refresh-toggle"
              type="checkbox"
              checked={autoRefreshEnabled}
              disabled={disableControls}
              onChange={(event) => setAutoRefreshEnabled(event.currentTarget.checked)}
            />
            <span>{t('quota_management.auto_refresh_enabled')}</span>
          </label>
          <select
            data-testid="quota-auto-refresh-interval"
            className={styles.autoRefreshSelect}
            value={autoRefreshIntervalMs}
            disabled={disableControls || !autoRefreshEnabled}
            onChange={(event) => setAutoRefreshIntervalMs(Number(event.currentTarget.value))}
            aria-label={t('quota_management.auto_refresh_interval')}
          >
            {AUTO_REFRESH_INTERVAL_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(`quota_management.auto_refresh_interval_${option}`)}
              </option>
            ))}
          </select>
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
        quotaRefreshSignal={quotaRefreshSignal}
      />
      <QuotaSection
        config={CODEX_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        quotaRefreshSignal={quotaRefreshSignal}
      />
      <QuotaSection
        config={GEMINI_CLI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        quotaRefreshSignal={quotaRefreshSignal}
      />
      <QuotaSection
        config={KIMI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        quotaRefreshSignal={quotaRefreshSignal}
      />
    </div>
  );
}
