import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import type { AuthFileItem, AuthFileStatusHistoryEntry } from '@/types';
import styles from './AuthFilesStatusHistoryPanel.module.scss';

const HISTORY_FETCH_LIMIT = 8;

type AuthFilesStatusHistoryPanelProps = {
  file: AuthFileItem;
  reloadKey?: number;
};

const formatOccurredAt = (value: string | undefined, locale: string) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return raw;
  return new Intl.DateTimeFormat(locale || undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
};

const resolveStatusVariant = (eventType: string) => {
  switch (eventType) {
    case 'cleared':
      return 'success';
    case 'warning':
      return 'warning';
    case 'check_failed':
      return 'failure';
    default:
      return 'neutral';
  }
};

const resolveStatusLabel = (t: ReturnType<typeof useTranslation>['t'], eventType: string) => {
  switch (eventType) {
    case 'cleared':
      return t('auth_files.status_history_status_cleared', {
        defaultValue: 'Cleared',
      });
    case 'warning':
      return t('auth_files.status_history_status_warning', {
        defaultValue: 'Still warning',
      });
    case 'check_failed':
      return t('auth_files.status_history_status_failed', {
        defaultValue: 'Check failed',
      });
    default:
      return t('auth_files.status_history_status_checked', {
        defaultValue: 'Checked',
      });
  }
};

const resolveTriggerLabel = (
  t: ReturnType<typeof useTranslation>['t'],
  trigger: string | undefined
) => {
  return String(trigger ?? '').trim().toLowerCase() === 'auto'
    ? t('auth_files.status_history_trigger_auto', {
        defaultValue: 'Automatic check',
      })
    : t('auth_files.status_history_trigger_manual', {
        defaultValue: 'Manual check',
      });
};

export function AuthFilesStatusHistoryPanel({
  file,
  reloadKey = 0,
}: AuthFilesStatusHistoryPanelProps) {
  const { t, i18n } = useTranslation();
  const seededEvents = useMemo(
    () =>
      Array.isArray(file.status_history)
        ? file.status_history.slice(0, HISTORY_FETCH_LIMIT)
        : [],
    [file.status_history]
  );
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<AuthFileStatusHistoryEntry[]>(seededEvents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);
  const loadedReloadKeyRef = useRef<number | null>(null);

  useEffect(() => {
    if (loadedReloadKeyRef.current === null) {
      setEvents(seededEvents);
    }
  }, [seededEvents]);

  const loadHistory = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');

    try {
      const nextEvents = await authFilesApi.getAuthStatusHistory(file.name, HISTORY_FETCH_LIMIT);
      if (requestId !== requestIdRef.current) return;
      setEvents(nextEvents);
      loadedReloadKeyRef.current = reloadKey;
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) return;
      const message = err instanceof Error ? err.message : '';
      setError(message || t('notification.refresh_failed'));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [file.name, reloadKey, t]);

  useEffect(() => {
    if (!expanded) return;
    if (loadedReloadKeyRef.current === reloadKey) return;
    void loadHistory();
  }, [expanded, loadHistory, reloadKey]);

  return (
    <div className={styles.inlineRoot}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {expanded
          ? t('auth_files.status_history_hide_button', {
              defaultValue: 'Hide status history',
            })
          : t('auth_files.status_history_show_button', {
              defaultValue: 'View status history',
            })}
      </button>

      {expanded && (
        <div className={styles.panel}>
          <div className={styles.content}>
            {loading ? (
              <div className={styles.loading}>{t('common.loading')}</div>
            ) : error ? (
              <div className={styles.error}>{error}</div>
            ) : events.length === 0 ? (
              <div className={styles.empty}>
                {t('auth_files.status_history_empty', {
                  defaultValue: 'No status checks have been recorded for this auth file yet.',
                })}
              </div>
            ) : (
              <div className={styles.list}>
                {events.map((event, index) => {
                  const eventType = String(event.event_type ?? '').trim().toLowerCase();
                  const variant = resolveStatusVariant(eventType);
                  const occurredAt = formatOccurredAt(event.occurred_at, i18n.language);
                  const triggerLabel = resolveTriggerLabel(t, event.trigger);
                  const provider = String(event.provider ?? '').trim();
                  const statusMessage = String(event.status_message ?? '').trim();
                  const previousMessage = String(event.previous_message ?? '').trim();
                  const errorMessage = String(event.error ?? '').trim();

                  return (
                    <div
                      key={`${event.occurred_at || 'unknown'}-${event.event_type || 'event'}-${index}`}
                      className={`${styles.item} ${variant === 'success' ? styles.itemSuccess : variant === 'warning' ? styles.itemWarning : variant === 'failure' ? styles.itemFailure : styles.itemNeutral}`}
                    >
                      <div className={styles.itemHeader}>
                        <div className={styles.itemSummary}>
                          <div className={styles.itemTitle}>
                            {occurredAt ||
                              t('auth_files.status_history_unknown_auth', {
                                defaultValue: 'Unknown check time',
                              })}
                          </div>
                          <div className={styles.meta}>
                            <span>{triggerLabel}</span>
                            {provider ? <span>{provider}</span> : null}
                            <span>{file.name}</span>
                          </div>
                        </div>

                        <span
                          className={`${styles.status} ${variant === 'success' ? styles.statusSuccess : variant === 'warning' ? styles.statusWarning : variant === 'failure' ? styles.statusFailure : styles.statusNeutral}`}
                        >
                          {resolveStatusLabel(t, eventType)}
                        </span>
                      </div>

                      <div className={styles.detailList}>
                        {statusMessage ? (
                          <div className={styles.detail}>
                            {t('auth_files.status_history_current_message', {
                              defaultValue: 'Current message',
                            })}
                            {': '}
                            {statusMessage}
                          </div>
                        ) : null}

                        {previousMessage ? (
                          <div className={styles.detail}>
                            {t('auth_files.status_history_previous_message', {
                              defaultValue: 'Previous message',
                            })}
                            {': '}
                            {previousMessage}
                          </div>
                        ) : null}

                        {errorMessage ? (
                          <div className={styles.detail}>
                            {t('auth_files.status_history_error', {
                              defaultValue: 'Error',
                            })}
                            {': '}
                            {errorMessage}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className={styles.footer}>
              {t('auth_files.status_history_footer', {
                defaultValue:
                  'Showing the newest history entries only. The source of truth is <authDir>/.auth-status-history/status.jsonl.',
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
