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
import { HealthPill, type HealthPillStatus } from '@/components/ui/HealthPill';
import { useFarmAccounts } from '../hooks/useFarmAccounts';
import { FARM_ENVS, type FarmDeviceIDSource, type FarmEnv } from '@/types/farm';
import { formatDateTimeUtc8 } from '@/utils/datetime';
import styles from './FarmAccountsPanel.module.scss';

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

// 账号健康四态映射（design.md 决策6「状态栏双列 A1」）：account.status 是 CPA
// 透传的自由字符串，未必收敛到 coreauth.Status 的 active/pending/error/disabled
// 四值，按语义分组而非逐值枚举。error/fatal→err（真实故障）；warn/degraded→warn
// （需要关注）；active/running/healthy/ok/valid→ok（健康态）；其它未知值（含
// status 字面量 "disabled"，disabled 已降级为账号名旁中性 tag，不在本列重复
// 表达）一律 idle 中性回退，不再借用 muted 徽标语义。
const ACCOUNT_HEALTH_STATUS: Record<string, HealthPillStatus> = {
  error: 'err',
  fatal: 'err',
  warn: 'warn',
  degraded: 'warn',
  active: 'ok',
  running: 'ok',
  healthy: 'ok',
  ok: 'ok',
  valid: 'ok',
};

// 容器健康四态映射：running=ok，degraded/orphaned=warn（幽灵态待人工核实，非
// 已确认故障），down=err，created/starting/retired=idle（未激活/已退役，非
// 故障态）。口径与 FarmContainerTable 的 STATUS_BADGE_VARIANT 分组一致，只是
// 四值枚举（ok/warn/err/idle）替代旧 success/warning/error/muted 徽标枚举。
const CONTAINER_HEALTH_STATUS: Record<string, HealthPillStatus> = {
  running: 'ok',
  degraded: 'warn',
  orphaned: 'warn',
  down: 'err',
  created: 'idle',
  starting: 'idle',
  retired: 'idle',
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

  // 双列列头文案同时复用为 <HealthPill dimension> 值（拼进 aria-label，如
  // 「账号健康: 运行中」），保证可见列头与朗读维度语义一致，只算一次而非
  // 每行重复 t() 调用。
  const accountHealthColumnLabel = t('farm.accountHealth.accountHealthColumn', {
    defaultValue: '账号健康',
  });
  const containerHealthColumnLabel = t('farm.accountHealth.containerHealthColumn', {
    defaultValue: '容器健康',
  });

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
              <TableHead>{accountHealthColumnLabel}</TableHead>
              <TableHead>{containerHealthColumnLabel}</TableHead>
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

              // 账号健康四态：按 account.status 查表，不再按 account.disabled 布尔
              // 选色。disabled 是良性暂停态（operator 主动关闭，非故障），已降级
              // 为账号名旁的中性 tag，不再挤占本列视觉权重（design.md 决策6）。
              const normalizedStatus = (account.status || 'active').trim().toLowerCase();
              const accountHealthStatus: HealthPillStatus = ACCOUNT_HEALTH_STATUS[normalizedStatus] ?? 'idle';
              const statusLabel = t(`farm.accounts.status_${normalizedStatus}`, {
                defaultValue: account.status || t('farm.accounts.status_active'),
              });
              const showDisabledTag = account.disabled && normalizedStatus !== 'disabled';

              // 容器健康四态：只在 farm_bound 时有意义；未绑定不是「故障」而是
              // 「无容器可报告」，仍用 idle HealthPill 呈现（而非留空/破版），
              // 保持两列视觉对称。containerStatus 收窄到 string 供下方索引
              // CONTAINER_HEALTH_STATUS 与 i18n key 使用。
              const containerStatus = account.farm_bound ? account.farm_container_status : undefined;
              const containerHealthStatus: HealthPillStatus = containerStatus
                ? CONTAINER_HEALTH_STATUS[containerStatus] ?? 'idle'
                : 'idle';
              const containerHealthLabel = containerStatus
                ? t(`farm.status.${containerStatus}`, { defaultValue: containerStatus })
                : t('farm.accountHealth.unbound', { defaultValue: 'Unbound' });
              // "有 LLM 请求但无遥测"不对称归因提示不再单独占一行可见文字，收进
              // HealthPill 的 title tooltip（HealthPill.reason），避免误导
              // operator 直接下线仍有真实流量的账号，同时不挤占列宽。
              const containerHealthReason = showDegradedHint
                ? t('farm.accountHealth.degradedHint')
                : undefined;
              // testid 固定为 farm-container-health-<name>，不随 showDegradedHint
              // 分支切换，保证真机断言可稳定定位该 pill；degraded 提示改由
              // TableCell 的 data-degraded-hint 属性单独标记，不覆盖主 testid。
              const containerHealthTestId = `farm-container-health-${account.name}`;

              return (
                <TableRow key={account.name} data-testid={`farm-account-row-${account.name}`}>
                  <TableCell data-label={t('farm.accounts.column_name')}>
                    <div className={styles.nameCell}>
                      <span>{account.name}</span>
                      {showDisabledTag ? (
                        <span
                          className={`status-badge muted ${styles.disabledTag}`}
                          data-testid={`farm-account-disabled-tag-${account.name}`}
                        >
                          {t('farm.accountHealth.disabledBadge', { defaultValue: 'Disabled' })}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell
                    data-testid={`farm-account-health-cell-${account.name}`}
                    data-label={accountHealthColumnLabel}
                  >
                    <HealthPill
                      status={accountHealthStatus}
                      label={statusLabel}
                      dimension={accountHealthColumnLabel}
                      data-testid={`farm-account-health-pill-${account.name}`}
                    />
                  </TableCell>
                  <TableCell
                    data-testid={`farm-container-health-cell-${account.name}`}
                    data-label={containerHealthColumnLabel}
                    data-degraded-hint={showDegradedHint ? 'true' : undefined}
                  >
                    <HealthPill
                      status={containerHealthStatus}
                      label={containerHealthLabel}
                      dimension={containerHealthColumnLabel}
                      reason={containerHealthReason}
                      data-testid={containerHealthTestId}
                    />
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
