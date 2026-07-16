import { useMemo, useState } from 'react';
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
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { FarmContainerView } from '@/types/farm';
import { formatDateTimeUtc8 } from '@/utils/datetime';
import { useFarmRetiredContainers } from '../hooks/useFarmRetiredContainers';
import styles from './FarmContainerTable.module.scss';

interface FarmContainerTableProps {
  containers: FarmContainerView[];
  loading: boolean;
  error: string;
  unbindingContainerId: string | null;
  retiringContainerId: string | null;
  onBind: (container: FarmContainerView) => void;
  onUnbind: (container: FarmContainerView) => void;
  onRetire: (container: FarmContainerView) => void;
}

// design.md 容器生命周期：created(已入池未起) / starting(已起等 Poller 判回) /
// running / degraded / down / retired(已退役，软删归档) / orphaned(幽灵态，
// 见 types/farm.ts FARM_DEVICE_ID_SOURCES 附近注释)。徽标着色映射到既有
// status-badge 全局样式（只有 success/warning/error/muted 四档）：
// retired 归为中性归档态用 muted；orphaned 是需要 operator 收敛的异常态用
// warning，与 degraded 同色但各自行内文案已经区分（"异常" vs "幽灵态"）。
const STATUS_BADGE_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'muted'> = {
  created: 'muted',
  starting: 'muted',
  running: 'success',
  degraded: 'warning',
  down: 'error',
  retired: 'muted',
  orphaned: 'warning',
};

// 过滤/分组桶：5 个具名分组（active/created/degraded/down/retired）+ 一个
// "全部"哨兵值。starting 归入 active（同属"容器进程已起"）。retired 桶实际是
// "归档态"集合：retired（软删归档）与 orphaned（幽灵态）都属 store.IsArchivedStatus
// （见 types/farm.ts），两者都会落进该桶——所以它的展示标签用「非活跃 / Inactive」
// 而非「已退役」，保证过滤标签与行内容（可能是已退役或幽灵态）语义自洽；行内
// 状态徽标仍按各自精确状态（已退役 / 幽灵态）着色区分。
type FarmContainerGroup = 'active' | 'created' | 'degraded' | 'down' | 'retired';
type FarmContainerFilter = 'all' | FarmContainerGroup;

const FARM_CONTAINER_GROUPS: FarmContainerGroup[] = ['active', 'created', 'degraded', 'down', 'retired'];

function groupOfStatus(status: string): FarmContainerGroup {
  switch (status) {
    case 'created':
      return 'created';
    case 'degraded':
      return 'degraded';
    case 'down':
      return 'down';
    case 'retired':
    case 'orphaned':
      return 'retired';
    case 'running':
    case 'starting':
    default:
      return 'active';
  }
}

function formatTokenUsage(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
}

export function FarmContainerTable({
  containers,
  loading,
  error,
  unbindingContainerId,
  retiringContainerId,
  onBind,
  onUnbind,
  onRetire,
}: FarmContainerTableProps) {
  const { t, i18n } = useTranslation();
  const [groupFilter, setGroupFilter] = useState<FarmContainerFilter>('active');

  // "已退役"分组数据不在默认活跃轮询里（见 useFarmContainers 顶部注释），只
  // 在 operator 选中 retired 或 all 时才按需拉取，避免默认视图/绑定弹窗的
  // 可绑定容器列表被归档数据污染。
  const needsRetired = groupFilter === 'retired' || groupFilter === 'all';
  const {
    containers: retiredContainers,
    loading: retiredLoading,
    error: retiredError,
  } = useFarmRetiredContainers(needsRetired);

  const rows = useMemo(() => {
    if (groupFilter === 'retired') return retiredContainers;
    if (groupFilter === 'all') return [...containers, ...retiredContainers];
    return containers.filter((c) => groupOfStatus(c.status) === groupFilter);
  }, [containers, retiredContainers, groupFilter]);

  const isLoading = loading || (needsRetired && retiredLoading);
  const combinedError = error || (needsRetired ? retiredError : '');

  const filterOptions = [
    { value: 'all', label: t('farm.filter.all') },
    ...FARM_CONTAINER_GROUPS.map((group) => ({ value: group, label: t(`farm.group.${group}`) })),
  ];

  return (
    <div className={styles.tableWrap} data-testid="farm-container-table-wrap">
      <div className={styles.filterBar} data-testid="farm-container-filter">
        <span className={styles.filterLabel}>{t('farm.filter.statusLabel')}</span>
        <Select
          value={groupFilter}
          options={filterOptions}
          onChange={(value) => setGroupFilter(value as FarmContainerFilter)}
          ariaLabel={t('farm.filter.statusLabel')}
          size="sm"
          fullWidth={false}
          className={styles.filterSelect}
        />
      </div>

      {isLoading ? (
        <div className={styles.loadingState} data-testid="farm-containers-loading">
          <LoadingSpinner />
          <span>{t('common.loading')}</span>
        </div>
      ) : combinedError ? (
        <div className="error-box" data-testid="farm-containers-error">
          {combinedError}
        </div>
      ) : rows.length === 0 ? (
        <div data-testid="farm-containers-empty">
          <EmptyState
            title={t('farm.containers.empty_title')}
            description={t('farm.containers.empty_desc')}
          />
        </div>
      ) : (
        <Table data-testid="farm-container-table">
          <TableHeader>
            <TableRow>
              <TableHead>{t('farm.containers.column_device')}</TableHead>
              <TableHead>{t('farm.containers.column_status')}</TableHead>
              <TableHead className={styles.colSecondary}>
                {t('farm.containers.column_keepalive')}
              </TableHead>
              <TableHead>{t('farm.containers.column_token_usage')}</TableHead>
              <TableHead>{t('farm.containers.column_binding')}</TableHead>
              <TableHead alignRight>{t('farm.containers.column_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((container) => {
              const statusVariant = STATUS_BADGE_VARIANT[container.status] ?? 'muted';
              const statusLabel = t(`farm.status.${container.status}`, {
                defaultValue: container.status,
              });
              const isUnbinding = unbindingContainerId === container.id;
              const isRetiring = retiringContainerId === container.id;
              const isArchived = container.status === 'retired' || container.status === 'orphaned';
              const isBound = Boolean(container.binding);

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
                  <TableCell className={styles.colSecondary}>
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
                      {isArchived ? (
                        // 已归档容器不再提供任何行操作：不能重新绑定（设备已
                        // 不受农场管控），也不能再退役一次。
                        <span className={styles.mono}>—</span>
                      ) : isBound ? (
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
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onBind(container)}
                            data-testid={`farm-bind-button-${container.id}`}
                          >
                            {t('farm.containers.action_bind')}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={isRetiring}
                            onClick={() => onRetire(container)}
                            data-testid={`farm-retire-button-${container.id}`}
                          >
                            {t('farm.actions.retire')}
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
