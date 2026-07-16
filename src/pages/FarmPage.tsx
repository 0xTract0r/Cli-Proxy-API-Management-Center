/**
 * 农场（Device Farm）页 —— 连独立的农场编排器后端（services/farm-orchestrator），
 * 不是 CPA 管理中心的一部分。页面自带独立配置入口（FarmConfigPanel），未配置
 * 编排器地址/admin key 前，容器池区域只展示配置引导，不发起任何 /api/farm 请求
 * （见 useFarmStore.isConfigured 与各 hook 的 isConfigured 短路）。
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { farmApi } from '@/services/api/farm';
import { useFarmStore, useNotificationStore } from '@/stores';
import { FarmConfigPanel } from '@/features/farm/components/FarmConfigPanel';
import { FarmAccountsPanel } from '@/features/farm/components/FarmAccountsPanel';
import { FarmContainerTable } from '@/features/farm/components/FarmContainerTable';
import { FarmBindModal } from '@/features/farm/components/FarmBindModal';
import { FarmResourcePanel } from '@/features/farm/components/FarmResourcePanel';
import { FarmUsagePanel } from '@/features/farm/components/FarmUsagePanel';
import { useFarmContainers } from '@/features/farm/hooks/useFarmContainers';
import { useFarmBindings } from '@/features/farm/hooks/useFarmBindings';
import { useFarmRetire } from '@/features/farm/hooks/useFarmRetire';
import type { FarmContainerView } from '@/types/farm';
import styles from './FarmPage.module.scss';

export function FarmPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const isConfigured = useFarmStore((state) => state.isConfigured);

  const { containers, setContainers, loading, error, reload } = useFarmContainers();
  const { bindingPending, unbindingContainerId, bind, unbind } = useFarmBindings({
    setContainers,
    reload,
  });
  const { retiringContainerId, retire } = useFarmRetire({ setContainers, reload });

  const [bindModalOpen, setBindModalOpen] = useState(false);
  const [preselectedContainerId, setPreselectedContainerId] = useState<string | null>(null);
  const [newContainerSuffix, setNewContainerSuffix] = useState('');
  const [creatingContainer, setCreatingContainer] = useState(false);

  const openBindModal = useCallback((container?: FarmContainerView) => {
    setPreselectedContainerId(container?.id ?? null);
    setBindModalOpen(true);
  }, []);

  const closeBindModal = useCallback(() => setBindModalOpen(false), []);

  const handleCreateContainer = useCallback(async () => {
    const id = newContainerSuffix.trim();
    if (!id) return;
    setCreatingContainer(true);
    try {
      await farmApi.createContainer({ id });
      setNewContainerSuffix('');
      showNotification(t('farm.containers.create_success', { id }), 'success');
      await reload();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('farm.error.create_failed');
      showNotification(`${t('farm.error.create_failed')}: ${message}`, 'error');
    } finally {
      setCreatingContainer(false);
    }
  }, [newContainerSuffix, reload, showNotification, t]);

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('farm.title')}</h1>
      <p className={styles.subtitle}>{t('farm.subtitle')}</p>

      <div className={styles.content}>
        <FarmConfigPanel />

        {isConfigured ? <FarmAccountsPanel /> : null}

        <Card
          title={t('farm.containers.title')}
          extra={
            isConfigured ? (
              <div className={styles.createContainerBar}>
                <Input
                  value={newContainerSuffix}
                  onChange={(event) => setNewContainerSuffix(event.target.value)}
                  placeholder={t('farm.containers.create_placeholder')}
                  data-testid="farm-create-container-input"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCreateContainer}
                  loading={creatingContainer}
                  disabled={!newContainerSuffix.trim()}
                  data-testid="farm-create-container-button"
                >
                  {t('farm.containers.create_button')}
                </Button>
              </div>
            ) : null
          }
        >
          <p className={styles.sectionDescription}>{t('farm.containers.desc')}</p>
          {!isConfigured ? (
            <div data-testid="farm-not-configured">
              <EmptyState
                title={t('farm.containers.not_configured_title')}
                description={t('farm.containers.not_configured_desc')}
              />
            </div>
          ) : (
            <FarmContainerTable
              containers={containers}
              loading={loading}
              error={error}
              unbindingContainerId={unbindingContainerId}
              retiringContainerId={retiringContainerId}
              onBind={openBindModal}
              onUnbind={unbind}
              onRetire={retire}
            />
          )}
        </Card>

        {isConfigured ? <FarmResourcePanel /> : null}
        {isConfigured ? <FarmUsagePanel /> : null}
      </div>

      <FarmBindModal
        open={bindModalOpen}
        submitting={bindingPending}
        containers={containers}
        preselectedContainerId={preselectedContainerId}
        onClose={closeBindModal}
        onSubmit={bind}
      />
    </div>
  );
}
