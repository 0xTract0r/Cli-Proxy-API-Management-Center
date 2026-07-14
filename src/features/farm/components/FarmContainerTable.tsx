import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { FarmContainerView } from '@/types/farm';
import { formatDateTimeUtc8 } from '@/utils/datetime';
import styles from './FarmContainerTable.module.scss';

interface FarmContainerTableProps {
  containers: FarmContainerView[];
  loading: boolean;
  error: string;
  unbindingContainerId: string | null;
  onBind: (container: FarmContainerView) => void;
  onUnbind: (container: FarmContainerView) => void;
}

// design.md 容器生命周期：created(已入池未起) / starting(已起等 Poller 判回) /
// running / degraded / down。徽标着色映射到既有 status-badge 全局样式。
const STATUS_BADGE_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'muted'> = {
  created: 'muted',
  starting: 'muted',
  running: 'success',
  degraded: 'warning',
  down: 'error',
};

function formatTokenUsage(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
}

export function FarmContainerTable({
  containers,
  loading,
  error,
  unbindingContainerId,
  onBind,
  onUnbind,
}: FarmContainerTableProps) {
  const { t, i18n } = useTranslation();

  if (loading) {
    return (
      <div className={styles.loadingState} data-testid="farm-containers-loading">
        <LoadingSpinner />
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-box" data-testid="farm-containers-error">
        {error}
      </div>
    );
  }

  if (containers.length === 0) {
    return (
      <div data-testid="farm-containers-empty">
        <EmptyState
          title={t('farm.containers.empty_title')}
          description={t('farm.containers.empty_desc')}
        />
      </div>
    );
  }

  return (
    <Table data-testid="farm-container-table">
      <TableHeader>
        <TableRow>
          <TableHead>{t('farm.containers.column_device')}</TableHead>
          <TableHead>{t('farm.containers.column_status')}</TableHead>
          <TableHead>{t('farm.containers.column_keepalive')}</TableHead>
          <TableHead>{t('farm.containers.column_token_usage')}</TableHead>
          <TableHead>{t('farm.containers.column_binding')}</TableHead>
          <TableHead alignRight>{t('farm.containers.column_actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {containers.map((container) => {
          const statusVariant = STATUS_BADGE_VARIANT[container.status] ?? 'muted';
          const statusLabel = t(`farm.status.${container.status}`, {
            defaultValue: container.status,
          });
          const isUnbinding = unbindingContainerId === container.id;

          return (
            <TableRow key={container.id} data-testid={`farm-container-row-${container.id}`}>
              <TableCell>
                <div className={styles.deviceCell}>
                  <span className={styles.containerId}>{container.id}</span>
                  <span className={styles.deviceIdMasked}>{container.device_id_masked}</span>
                </div>
              </TableCell>
              <TableCell>
                <span className={`status-badge ${statusVariant}`}>{statusLabel}</span>
              </TableCell>
              <TableCell>
                <span className={styles.mono}>
                  {container.last_keepalive_at
                    ? formatDateTimeUtc8(container.last_keepalive_at, i18n.language)
                    : t('farm.containers.never')}
                </span>
              </TableCell>
              <TableCell>
                <span className={styles.mono}>{formatTokenUsage(container.token_usage)}</span>
              </TableCell>
              <TableCell>
                {container.binding ? (
                  <div className={styles.bindingCell}>
                    <span className={styles.bindingAccount}>{container.binding.account}</span>
                    <span className={styles.chip}>{t(`farm.env.${container.binding.env}`, {
                      defaultValue: container.binding.env,
                    })}</span>
                  </div>
                ) : (
                  <span className={styles.mono}>{t('farm.containers.no_binding')}</span>
                )}
              </TableCell>
              <TableCell alignRight>
                <div className={styles.actions}>
                  {container.binding ? (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={isUnbinding}
                      onClick={() => onUnbind(container)}
                      data-testid={`farm-unbind-button-${container.id}`}
                    >
                      {t('farm.containers.action_unbind')}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onBind(container)}
                      data-testid={`farm-bind-button-${container.id}`}
                    >
                      {t('farm.containers.action_bind')}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
