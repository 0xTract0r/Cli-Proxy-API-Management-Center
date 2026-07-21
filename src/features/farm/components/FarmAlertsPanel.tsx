import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AsyncPanel } from '@/components/ui/AsyncPanel';
import { HealthPill, type HealthPillStatus } from '@/components/ui/HealthPill';
import { Select } from '@/components/ui/Select';
import type { FarmAlertEntry } from '@/types/farm';
import { formatDateTimeUtc8 } from '@/utils/datetime';
import { useFarmAlerts } from '../hooks/useFarmAlerts';
import styles from './FarmAlertsPanel.module.scss';

// severity 三态（eventView.severity，farmrunner recordStatusTransition 写入）
// → HealthPill 四态：critical=err、warning=warn、info=idle（信息性，非故障）。
const SEVERITY_TO_PILL: Record<FarmAlertEntry['severity'], HealthPillStatus> = {
  critical: 'err',
  warning: 'warn',
  info: 'idle',
};

type AlertStatusFilter = 'firing' | 'resolved' | 'all';

/**
 * 跨容器告警 feed（design.md 决策6，tasks.md P0-9），消费 GET /api/farm/alerts
 * （P0-5，services/farm-orchestrator/internal/httpapi 已注册 handleGetAlerts
 * 并测试通过，见 useFarmAlerts.ts 注释）。firing/resolved 两态分别渲染：
 * resolved_at 存在=已恢复（弱化展示），缺失=仍在 firing（用 severity 语义色
 * 高亮）。AsyncPanel 的 error 态只在真实请求失败（网络/鉴权/后端 5xx 等）时
 * 出现，不再是本端点未注册的预期常态。
 */
export function FarmAlertsPanel() {
  const { t, i18n } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<AlertStatusFilter>('firing');
  const { alerts, loading, error } = useFarmAlerts({ status: statusFilter, window: '24h' });

  const statusOptions: Array<{ value: AlertStatusFilter; label: string }> = [
    { value: 'firing', label: t('farm.alerts.filterFiring', { defaultValue: '进行中' }) },
    { value: 'resolved', label: t('farm.alerts.filterResolved', { defaultValue: '已恢复' }) },
    { value: 'all', label: t('farm.filter.all') },
  ];

  return (
    <div className={styles.panel} data-testid="farm-alerts-panel">
      <div className={styles.header}>
        <div className={styles.title}>{t('farm.alerts.title', { defaultValue: '农场告警' })}</div>
        <Select
          value={statusFilter}
          options={statusOptions}
          onChange={(value) => setStatusFilter(value as AlertStatusFilter)}
          ariaLabel={t('farm.alerts.filterLabel', { defaultValue: '告警状态' })}
          size="sm"
          fullWidth={false}
          className={styles.filterSelect}
        />
      </div>
      <p className={styles.desc}>
        {t('farm.alerts.desc', {
          defaultValue: '跨容器状态事件（resolved 事件历史尚未完整落地，见交付说明）。',
        })}
      </p>

      <AsyncPanel
        loading={loading}
        error={error}
        isEmpty={alerts.length === 0}
        loadingLabel={t('common.loading')}
        loadingTestId="farm-alerts-loading"
        errorTestId="farm-alerts-error"
        empty={{
          title: t('farm.alerts.emptyTitle', { defaultValue: '暂无告警' }),
          description: t('farm.alerts.emptyDesc', {
            defaultValue: '当前筛选条件下没有状态事件。',
          }),
          testId: 'farm-alerts-empty',
        }}
      >
        <ul className={styles.list} data-testid="farm-alerts-list">
          {alerts.map((alert) => {
            const resolved = Boolean(alert.resolved_at);
            const pillStatus: HealthPillStatus = resolved ? 'idle' : SEVERITY_TO_PILL[alert.severity];
            const pillLabel = resolved
              ? t('farm.alerts.resolvedLabel', { defaultValue: '已恢复' })
              : t(`farm.alerts.severity_${alert.severity}`, { defaultValue: alert.severity });
            return (
              <li
                key={alert.id}
                className={styles.item}
                data-testid={`farm-alert-item-${alert.id}`}
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
                        {t('farm.alerts.resolvedAt', { defaultValue: '恢复于' })}{' '}
                        {formatDateTimeUtc8(alert.resolved_at, i18n.language)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </AsyncPanel>
    </div>
  );
}
