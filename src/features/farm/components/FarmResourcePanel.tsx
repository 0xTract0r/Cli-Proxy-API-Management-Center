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
import { formatFileSize } from '@/utils/format';
import { useFarmResources } from '../hooks/useFarmResources';
import styles from './FarmResourcePanel.module.scss';

// 水位着色阈值：后端没有给出分级口径，这里按常见运维经验值选取
// （>=90% 视为紧急、>=70% 视为需要关注），仅用于视觉提示，不影响数据本身。
function pctVariant(pct: number | undefined): 'success' | 'warning' | 'error' | 'muted' {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 'muted';
  if (pct >= 90) return 'error';
  if (pct >= 70) return 'warning';
  return 'success';
}

function formatPct(pct: number | undefined): string {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return '—';
  return `${pct.toFixed(1)}%`;
}

/**
 * 资源占用面板：消费 GET /api/farm/resources（已绑定且 running 的农场容器
 * docker stats --no-stream 快照 + 整机资源水位）。host.note 固定携带
 * "整机含非农场进程"口径说明，原样展示，不另造措辞；取不到时后端已把数值
 * 字段回退为 0，这里不再臆造。
 */
export function FarmResourcePanel() {
  const { t } = useTranslation();
  const { containers, host, loading, error, reload } = useFarmResources();

  return (
    <div className={styles.panel} data-testid="farm-resource-panel">
      <div className={styles.header}>
        <div className={styles.title}>{t('farm.resources.title')}</div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => reload()}
          data-testid="farm-resources-refresh"
        >
          {t('common.refresh')}
        </Button>
      </div>

      {loading ? (
        <div className={styles.loadingState}>
          <LoadingSpinner size={16} />
          <span>{t('common.loading')}</span>
        </div>
      ) : error ? (
        <div className="error-box">{error}</div>
      ) : (
        <>
          {host ? (
            <div className={styles.hostRow} data-testid="farm-resource-host">
              <span className={styles.hostLabel}>{t('farm.resources.hostTitle')}</span>
              <span className={`status-badge ${pctVariant(host.mem_pct)}`}>
                {t('farm.resources.mem')} {formatFileSize(host.mem_used_bytes)} /{' '}
                {formatFileSize(host.mem_total_bytes)} ({formatPct(host.mem_pct)})
              </span>
              <span className={styles.hostMeta}>
                load1 {host.load1.toFixed(2)} · {host.cpu_count} CPU
              </span>
              <p className={styles.note}>{host.note}</p>
            </div>
          ) : null}

          {containers.length === 0 ? (
            <div data-testid="farm-resource-empty">
              <EmptyState
                title={t('farm.resources.empty', { defaultValue: 'No container resource data yet' })}
              />
            </div>
          ) : (
            <Table data-testid="farm-resource-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('farm.containers.column_device')}</TableHead>
                  <TableHead className={styles.colSecondary}>
                    {t('farm.accounts.column_name')}
                  </TableHead>
                  <TableHead>
                    {t('farm.resources.mem')} / {t('farm.resources.limit')}
                  </TableHead>
                  <TableHead>{t('farm.resources.cpu')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containers.map((item) => (
                  <TableRow
                    key={item.container_id}
                    data-testid={`farm-resource-row-${item.container_id}`}
                  >
                    <TableCell>
                      <span className={styles.mono}>{item.container_id}</span>
                    </TableCell>
                    <TableCell className={styles.colSecondary}>{item.account_id}</TableCell>
                    <TableCell>
                      <span className={`status-badge ${pctVariant(item.mem_pct)}`}>
                        {formatFileSize(item.mem_used_bytes)} / {formatFileSize(item.mem_limit_bytes)}{' '}
                        ({formatPct(item.mem_pct)})
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`status-badge ${pctVariant(item.cpu_pct)}`}>
                        {formatPct(item.cpu_pct)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
