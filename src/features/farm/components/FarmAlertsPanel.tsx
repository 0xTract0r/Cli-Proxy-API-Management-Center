import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AsyncPanel } from '@/components/ui/AsyncPanel';
import { Button } from '@/components/ui/Button';
import { HealthPill, type HealthPillStatus } from '@/components/ui/HealthPill';
import { Select } from '@/components/ui/Select';
import type { FarmAlertEntry } from '@/types/farm';
import { formatDateTimeUtc8 } from '@/utils/datetime';
import { useFarmAlerts } from '../hooks/useFarmAlerts';
import styles from './FarmAlertsPanel.module.scss';

const SEVERITY_TO_PILL: Record<FarmAlertEntry['severity'], HealthPillStatus> = {
  critical: 'err',
  warning: 'warn',
  info: 'idle',
};

type AlertStatusFilter = 'firing' | 'resolved' | 'all';

interface FarmAlertsPanelProps {
  mode?: 'summary' | 'full';
  onViewAll?: () => void;
}

/**
 * summary 固定消费 firing feed 且最多显示三条；full 保留既有
 * firing/resolved/all 筛选和全部动态 testid。后端顺序原样保留，前端不虚构严重度排序。
 */
export function FarmAlertsPanel({ mode = 'full', onViewAll }: FarmAlertsPanelProps) {
  const { t, i18n } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<AlertStatusFilter>('firing');
  const effectiveFilter = mode === 'summary' ? 'firing' : statusFilter;
  const { alerts, loading, error } = useFarmAlerts({ status: effectiveFilter, window: '24h' });
  const visibleAlerts = mode === 'summary' ? alerts.slice(0, 3) : alerts;

  const statusOptions: Array<{ value: AlertStatusFilter; label: string }> = [
    { value: 'firing', label: t('farm.alerts.filterFiring') },
    { value: 'resolved', label: t('farm.alerts.filterResolved') },
    { value: 'all', label: t('farm.filter.all') },
  ];

  return (
    <div
      className={`${styles.panel} ${mode === 'summary' ? styles.summary : ''}`}
      data-testid={mode === 'summary' ? 'farm-alert-summary' : 'farm-alerts-panel'}
    >
      <div className={styles.header}>
        <div className={styles.title}>{t('farm.alerts.title')}</div>
        {mode === 'full' ? (
          <div data-testid="farm-alerts-filter">
            <Select
              value={statusFilter}
              options={statusOptions}
              onChange={(value) => setStatusFilter(value as AlertStatusFilter)}
              ariaLabel={t('farm.alerts.filterLabel')}
              size="sm"
              fullWidth={false}
              className={styles.filterSelect}
              id="farm-alerts-filter-control"
            />
          </div>
        ) : onViewAll ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onViewAll}
            aria-haspopup="dialog"
            data-testid="farm-alerts-view-all"
          >
            {t('farm.alerts.viewAll')}
          </Button>
        ) : null}
      </div>
      <p className={styles.desc}>
        {mode === 'summary' ? t('farm.alerts.summaryDesc') : t('farm.alerts.desc')}
      </p>

      <AsyncPanel
        loading={loading}
        error={error}
        isEmpty={visibleAlerts.length === 0}
        loadingLabel={t('common.loading')}
        loadingTestId="farm-alerts-loading"
        errorTestId="farm-alerts-error"
        empty={{
          title: t('farm.alerts.emptyTitle'),
          description: t('farm.alerts.emptyDesc'),
          testId: 'farm-alerts-empty',
        }}
      >
        <ul className={styles.list} data-testid="farm-alerts-list">
          {visibleAlerts.map((alert) => {
            const resolved = Boolean(alert.resolved_at);
            const pillStatus: HealthPillStatus = resolved ? 'idle' : SEVERITY_TO_PILL[alert.severity];
            const pillLabel = resolved
              ? t('farm.alerts.resolvedLabel')
              : t(`farm.alerts.severity_${alert.severity}`, { defaultValue: alert.severity });
            return (
              <li
                key={alert.id}
                className={styles.item}
                data-testid={
                  mode === 'summary'
                    ? `farm-alert-summary-item-${alert.id}`
                    : `farm-alert-item-${alert.id}`
                }
                data-alert-id={alert.id}
                data-resolved={resolved ? 'true' : 'false'}
              >
                <HealthPill
                  status={pillStatus}
                  label={pillLabel}
                  data-testid={`farm-alert-pill-${alert.id}`}
                />
                <div className={styles.itemBody}>
                  <div className={styles.itemHead}>
                    <span className={styles.containerId}>{alert.container_id}</span>
                    <span className={styles.reason}>
                      {t(`farm.healthReason.${alert.reason}`, { defaultValue: alert.reason })}
                    </span>
                  </div>
                  <div className={styles.itemMeta}>
                    <span>
                      {alert.from_status
                        ? `${t(`farm.status.${alert.from_status}`, { defaultValue: alert.from_status })} → `
                        : ''}
                      {t(`farm.status.${alert.to_status}`, { defaultValue: alert.to_status })}
                    </span>
                    <span className={styles.mono}>{formatDateTimeUtc8(alert.ts, i18n.language)}</span>
                    {resolved && alert.resolved_at ? (
                      <span className={styles.mono}>
                        {t('farm.alerts.resolvedAt')}{' '}
                        {formatDateTimeUtc8(alert.resolved_at, i18n.language)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {mode === 'summary' && alerts.length > 3 && onViewAll ? (
          <div className={styles.moreRow} data-testid="farm-alert-summary-overflow">
            <span>{t('farm.alerts.moreCount', { count: alerts.length - 3 })}</span>
            <Button variant="ghost" size="sm" onClick={onViewAll} aria-haspopup="dialog">
              {t('farm.alerts.viewAll')}
            </Button>
          </div>
        ) : null}
      </AsyncPanel>
    </div>
  );
}
