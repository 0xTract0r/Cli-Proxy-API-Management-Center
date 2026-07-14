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
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useFarmAccounts } from '../hooks/useFarmAccounts';
import { FARM_ENVS, type FarmEnv } from '@/types/farm';
import styles from './FarmAccountsPanel.module.scss';

/**
 * 账号健康区：复用 GET /api/farm/accounts?env=<env>（编排器透传 CPA 该
 * 环境既有 GET /auth-files 健康列表，见 handlers.go handleListAccounts），
 * operator 借此在挑账号绑定前先看清哪些账号可用。
 */
export function FarmAccountsPanel() {
  const { t } = useTranslation();
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

      {loading ? (
        <div className={styles.loadingState}>
          <LoadingSpinner size={16} />
          <span>{t('common.loading')}</span>
        </div>
      ) : error ? (
        <div className="error-box">{error}</div>
      ) : accounts.length === 0 ? (
        <EmptyState
          title={t('farm.accounts.empty_title')}
          description={t('farm.accounts.empty_desc')}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('farm.accounts.column_name')}</TableHead>
              <TableHead>{t('farm.accounts.column_status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.name}>
                <TableCell>{account.name}</TableCell>
                <TableCell>
                  <span
                    className={`status-badge ${account.disabled ? 'error' : 'success'}`}
                  >
                    {account.disabled ? t('farm.accounts.status_disabled') : account.status || t('farm.accounts.status_active')}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
