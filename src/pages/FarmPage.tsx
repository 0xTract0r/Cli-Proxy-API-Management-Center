import { useTranslation } from 'react-i18next';
import { FarmDashboard } from '@/features/farm/components/FarmDashboard';
import styles from './FarmPage.module.scss';

export function FarmPage() {
  const { t } = useTranslation();

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('farm.title')}</h1>
      <p className={styles.subtitle}>{t('farm.subtitle')}</p>
      <FarmDashboard />
    </div>
  );
}
