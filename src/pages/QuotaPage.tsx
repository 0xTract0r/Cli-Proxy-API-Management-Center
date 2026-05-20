/**
 * Quota management page - coordinates quota sections.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';
import { authFilesApi, configFileApi, quotaApi } from '@/services/api';
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
    setError('');
    try {
      await Promise.all([handleHeaderRefresh(), quotaApi.refresh({})]);
      setQuotaRefreshSignal((value) => value + 1);
      setLastPageRefreshAt(new Date());
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      pageRefreshInFlightRef.current = false;
      setPageRefreshInFlight(false);
    }
  }, [disableControls, handleHeaderRefresh, t]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadFiles(), loadConfig()]).finally(() => {
      if (!cancelled) {
        setQuotaRefreshSignal((value) => value + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadFiles, loadConfig]);

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
