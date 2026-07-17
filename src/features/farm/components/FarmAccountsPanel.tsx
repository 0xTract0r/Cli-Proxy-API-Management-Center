import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { Select } from '@/components/ui/Select';
import { AsyncPanel } from '@/components/ui/AsyncPanel';
import { useFarmAccounts } from '../hooks/useFarmAccounts';
import { FARM_ENVS, type FarmDeviceIDSource, type FarmEnv } from '@/types/farm';
import { formatDateTimeUtc8 } from '@/utils/datetime';
import styles from './FarmAccountsPanel.module.scss';

// 农场绑定容器状态徽标着色，口径与 FarmContainerTable 的 STATUS_BADGE_VARIANT
// 一致（复制一份小映射，不跨组件文件耦合导出）：created/starting=muted，
// running=success，degraded/orphaned=warning，down=error，retired=muted。
const FARM_CONTAINER_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'muted'> = {
  created: 'muted',
  starting: 'muted',
  running: 'success',
  degraded: 'warning',
  down: 'error',
  retired: 'muted',
  orphaned: 'warning',
};

// device_id 展示口径四态着色（spec「device_id 展示口径全站对齐」）：
// container_synced=真实容器同步(success)，drift=正在漂移待对账(warning)，
// synthetic=确认非农场绑定按账号派生合成(muted，正常态非异常)，
// unknown=后端无法确定绑定关系(muted，中性回退非异常)。
const DEVICE_ID_SOURCE_VARIANT: Record<FarmDeviceIDSource, 'success' | 'warning' | 'error' | 'muted'> = {
  container_synced: 'success',
  drift: 'warning',
  synthetic: 'muted',
  unknown: 'muted',
};

// 账号真实状态徽标着色，参照 FarmContainerTable.tsx 的 STATUS_BADGE_VARIANT 范式，
// 但按语义分组而非逐值枚举（account.status 是 CPA 透传的自由字符串，未必收敛到
// coreauth.Status 的 active/pending/error/disabled 四值）：error/fatal→error（真实
// 故障）；warn/degraded→warning（需要关注）；active/running/healthy/ok/valid→success
// （健康态）；其它未知值一律 muted 中性回退。修复前的 bug：徽标只按 account.disabled
// 布尔选色（非 disabled 恒绿、disabled 恒红），完全忽略真实 status 严重度。
const ACCOUNT_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'muted'> = {
  error: 'error',
  fatal: 'error',
  warn: 'warning',
  degraded: 'warning',
  active: 'success',
  running: 'success',
  healthy: 'success',
  ok: 'success',
  valid: 'success',
};

/**
 * 账号健康区：复用 GET /api/farm/accounts?env=<env>（编排器透传 CPA 该
 * 环境既有 GET /auth-files 健康列表，见 handlers.go handleListAccounts），
 * operator 借此在挑账号绑定前先看清哪些账号可用；同时展示最近刷新时间、
 * 重新授权入口与禁用状态，帮助定位需要人工介入的账号。
 */
export function FarmAccountsPanel() {
  const { t, i18n } = useTranslation();
  const [env, setEnv] = useState<FarmEnv>('test');
  const { accounts, loading, error } = useFarmAccounts(env);

  const envOptions = FARM_ENVS.map((value) => ({ value, label: t(`farm.env.${value}`) }));

  return (
    <div className={styles.panel} data-testid="farm-accounts-panel">
      <div className={styles.header}>
        <div className={styles.title}>{t('farm.accounts.title')}</div>
        <Select
          value={env}
          options={envOptions}
          onChange={(value) => setEnv(value as FarmEnv)}
          ariaLabel={t('farm.bind_modal.env_label')}
          size="sm"
          fullWidth={false}
          className={styles.envSelect}
        />
      </div>
      <p className={styles.desc}>{t('farm.accounts.desc')}</p>

      <AsyncPanel
        loading={loading}
        error={error}
        isEmpty={accounts.length === 0}
        loadingLabel={t('common.loading')}
        empty={{
          title: t('farm.accounts.empty_title'),
          description: t('farm.accounts.empty_desc'),
        }}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('farm.accounts.column_name')}</TableHead>
              <TableHead>{t('farm.accounts.column_status')}</TableHead>
              <TableHead>
                {t('farm.accountHealth.deviceIdSourceColumn', {
                  defaultValue: 'Device ID source',
                })}
              </TableHead>
              <TableHead>{t('farm.accountHealth.lastRefresh')}</TableHead>
              <TableHead>{t('farm.accountHealth.reauthUrl')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => {
              // "有 LLM 请求但无遥测"不对称归因提示：账号绑定的农场容器已经
              // 被判 degraded，但账号本身仍有真实 LLM 流量（recent_requests
              // 或 success > 0），说明当前 degraded 更可能是遥测/保活侧信号
              // 缺失，未必是账号真的故障——避免误导 operator 直接下线账号。
              const hasLlmTraffic = (account.recent_requests ?? 0) > 0 || (account.success ?? 0) > 0;
              const showDegradedHint =
                account.farm_bound && account.farm_container_status === 'degraded' && hasLlmTraffic;

              // 真实状态严重度徽标：按 account.status 查表，不再按 account.disabled
              // 布尔选色。disabled 是良性暂停态（operator 主动关闭，非故障），单独
              // 用一个中性 muted 徽标承载，与状态徽标并列展示，不覆盖/掩盖真实 status。
              const normalizedStatus = (account.status || 'active').trim().toLowerCase();
              const statusVariant = ACCOUNT_STATUS_VARIANT[normalizedStatus] ?? 'muted';
              const statusLabel = t(`farm.accounts.status_${normalizedStatus}`, {
                defaultValue: account.status || t('farm.accounts.status_active'),
              });

              // 账号级 status（account.status）与容器级 farm_container_status 是两个
              // 不同维度：账号有 LLM 流量可判「正常」，同时其绑定容器遥测降级为
              // 「异常」，两枚徽标并排却无标签会被读成自相矛盾。仅当两枚徽标同时出现
              // 时给账号徽标补维度标签「账号」；容器徽标只在 farm_bound 时渲染，始终补
              //「容器」标签（本就讲容器，永不冗余）。containerStatus 先收窄到 string，
              // 供下方索引 FARM_CONTAINER_STATUS_VARIANT 与 i18n key 使用。
              const containerStatus = account.farm_bound ? account.farm_container_status : undefined;
              const hasContainerBadge = Boolean(containerStatus);

              return (
                <TableRow key={account.name} data-testid={`farm-account-row-${account.name}`}>
                  <TableCell data-label={t('farm.accounts.column_name')}>{account.name}</TableCell>
                  <TableCell data-label={t('farm.accounts.column_status')}>
                    <div className={styles.statusCell}>
                      <div className={styles.badgeGroup}>
                        {hasContainerBadge ? (
                          <span className={styles.statusDim}>
                            <span className={styles.dimLabel}>
                              {t('farm.accountHealth.dimAccount', { defaultValue: '账号' })}
                            </span>
                            <span className={`status-badge ${statusVariant}`}>{statusLabel}</span>
                          </span>
                        ) : (
                          <span className={`status-badge ${statusVariant}`}>{statusLabel}</span>
                        )}
                        {account.disabled && normalizedStatus !== 'disabled' ? (
                          <span className="status-badge muted">
                            {t('farm.accountHealth.disabledBadge', { defaultValue: 'Disabled' })}
                          </span>
                        ) : null}
                        {containerStatus ? (
                          <span className={styles.statusDim}>
                            <span className={styles.dimLabel}>
                              {t('farm.accountHealth.dimContainer', { defaultValue: '容器' })}
                            </span>
                            <span
                              className={`status-badge ${
                                FARM_CONTAINER_STATUS_VARIANT[containerStatus] ?? 'muted'
                              }`}
                            >
                              {t(`farm.status.${containerStatus}`, {
                                defaultValue: containerStatus,
                              })}
                            </span>
                          </span>
                        ) : null}
                      </div>
                      {showDegradedHint ? (
                        <p
                          className={styles.degradedHint}
                          data-testid={`farm-account-degraded-hint-${account.name}`}
                        >
                          {t('farm.accountHealth.degradedHint')}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell
                    data-testid={`farm-account-device-id-source-${account.name}`}
                    data-label={t('farm.accountHealth.deviceIdSourceColumn', {
                      defaultValue: 'Device ID source',
                    })}
                  >
                    <div className={styles.deviceSourceCell}>
                      <span
                        className={`status-badge ${DEVICE_ID_SOURCE_VARIANT[account.device_id_source] ?? 'muted'}`}
                      >
                        {t(`auth_files.account_settings_device_id_source_${account.device_id_source}`, {
                          defaultValue: account.device_id_source,
                        })}
                      </span>
                      {account.farm_bound && account.farm_container_id ? (
                        <div
                          className={styles.deviceSourceMeta}
                          data-testid={`farm-account-device-id-meta-${account.name}`}
                        >
                          <span className={styles.mono}>{account.farm_container_id}</span>
                          {account.farm_env ? (
                            <span className={styles.chip}>
                              {t(`farm.env.${account.farm_env}`, { defaultValue: account.farm_env })}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell data-label={t('farm.accountHealth.lastRefresh')}>
                    <span className={`${styles.mono} ${styles.refreshTimestamp}`}>
                      {account.last_refresh
                        ? formatDateTimeUtc8(account.last_refresh, i18n.language)
                        : t('farm.containers.never')}
                    </span>
                  </TableCell>
                  <TableCell data-label={t('farm.accountHealth.reauthUrl')}>
                    {account.reauth_url ? (
                      <a
                        className={styles.reauthLink}
                        href={account.reauth_url}
                        target="_blank"
                        rel="noreferrer"
                        data-testid={`farm-account-reauth-${account.name}`}
                      >
                        {t('farm.accountHealth.reauthAction', { defaultValue: 'Re-authenticate' })}
                      </a>
                    ) : (
                      <span className={styles.mono}>—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </AsyncPanel>
    </div>
  );
}
