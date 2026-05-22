import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Line } from 'react-chartjs-2';
import {
  IconDiamond,
  IconDollarSign,
  IconSatellite,
  IconTimer,
  IconTrendingUp,
} from '@/components/ui/icons';
import {
  LATENCY_SOURCE_FIELD,
  calculateCacheMetricsFromDetails,
  calculateLatencyStatsFromDetails,
  calculateCost,
  formatCompactNumber,
  formatDurationMs,
  formatPerMinuteValue,
  formatUsd,
  collectUsageDetails,
  extractTotalTokens,
  type ModelPrice,
} from '@/utils/usage';
import { sparklineOptions } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './hooks/useUsageData';
import type { SparklineBundle } from './hooks/useSparklines';
import styles from '@/pages/UsagePage.module.scss';

interface StatCardData {
  key: string;
  label: string;
  icon: ReactNode;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  value: string;
  meta?: ReactNode;
  trend: SparklineBundle | null;
}

export interface StatCardsProps {
  usage: UsagePayload | null;
  loading: boolean;
  modelPrices: Record<string, ModelPrice>;
  hasCostData: boolean;
  rateWindowMinutes?: number;
  sparklines: {
    requests: SparklineBundle | null;
    tokens: SparklineBundle | null;
    rpm: SparklineBundle | null;
    tpm: SparklineBundle | null;
    cost: SparklineBundle | null;
  };
}

export function StatCards({
  usage,
  loading,
  modelPrices,
  hasCostData,
  rateWindowMinutes,
  sparklines
}: StatCardsProps) {
  const { t } = useTranslation();
  const latencyHint = t('usage_stats.latency_unit_hint', {
    field: LATENCY_SOURCE_FIELD,
    unit: t('usage_stats.duration_unit_ms'),
  });
  const cacheHitHint = t('usage_stats.cache_hit_request_rate_hint');

  const { tokenBreakdown, rateStats, totalCost, latencyStats } = useMemo(() => {
    const empty = {
      tokenBreakdown: {
        cachedTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        hitRequests: 0,
        totalRequests: 0,
        hitRate: 0,
        reasoningTokens: 0
      },
      rateStats: { rpm: 0, tpm: 0, windowMinutes: 0, requestCount: 0, tokenCount: 0 },
      totalCost: 0,
      latencyStats: {
        averageMs: null as number | null,
        totalMs: null as number | null,
        sampleCount: 0,
      },
    };

    if (!usage) return empty;
    const details = collectUsageDetails(usage);
    if (!details.length) return empty;

    const latencyStats = calculateLatencyStatsFromDetails(details);
    const cacheMetrics = calculateCacheMetricsFromDetails(details);

    let reasoningTokens = 0;
    let totalCost = 0;

    let requestCount = 0;
    let tokenCount = 0;
    let minTimestamp = Number.POSITIVE_INFINITY;
    let maxTimestamp = 0;

    details.forEach((detail) => {
      const tokens = detail.tokens;
      if (typeof tokens.reasoning_tokens === 'number') {
        reasoningTokens += tokens.reasoning_tokens;
      }

      requestCount += 1;
      tokenCount += extractTotalTokens(detail);

      const timestamp = detail.__timestampMs ?? 0;
      if (Number.isFinite(timestamp) && timestamp > 0) {
        minTimestamp = Math.min(minTimestamp, timestamp);
        maxTimestamp = Math.max(maxTimestamp, timestamp);
      }

      totalCost += calculateCost(detail, modelPrices);
    });

    const derivedWindowMinutes =
      Number.isFinite(rateWindowMinutes) && Number(rateWindowMinutes) > 0
        ? Number(rateWindowMinutes)
        : minTimestamp !== Number.POSITIVE_INFINITY && maxTimestamp > 0
          ? Math.max(1, (maxTimestamp - minTimestamp) / 60000)
          : 1;
    const denominator = derivedWindowMinutes > 0 ? derivedWindowMinutes : 1;
    return {
      tokenBreakdown: {
        cachedTokens: cacheMetrics.cacheReadTokens,
        cacheReadTokens: cacheMetrics.cacheReadTokens,
        cacheWriteTokens: cacheMetrics.cacheWriteTokens,
        hitRequests: cacheMetrics.hitRequests,
        totalRequests: cacheMetrics.totalRequests,
        hitRate: cacheMetrics.hitRate,
        reasoningTokens
      },
      rateStats: {
        rpm: requestCount / denominator,
        tpm: tokenCount / denominator,
        windowMinutes: denominator,
        requestCount,
        tokenCount,
      },
      totalCost,
      latencyStats,
    };
  }, [modelPrices, rateWindowMinutes, usage]);

  const statsCards: StatCardData[] = [
    {
      key: 'requests',
      label: t('usage_stats.total_requests'),
      icon: <IconSatellite size={16} />,
      accent: '#8b8680',
      accentSoft: 'rgba(139, 134, 128, 0.18)',
      accentBorder: 'rgba(139, 134, 128, 0.35)',
      value: loading ? '-' : (usage?.total_requests ?? 0).toLocaleString(),
      meta: (
        <>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#10b981' }} />
            {t('usage_stats.success_requests')}: {loading ? '-' : (usage?.success_count ?? 0)}
          </span>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#c65746' }} />
            {t('usage_stats.failed_requests')}: {loading ? '-' : (usage?.failure_count ?? 0)}
          </span>
          {latencyStats.sampleCount > 0 && (
            <span className={styles.statMetaItem} title={latencyHint}>
              {t('usage_stats.avg_time')}:{' '}
              {loading ? '-' : formatDurationMs(latencyStats.averageMs)}
            </span>
          )}
        </>
      ),
      trend: sparklines.requests,
    },
    {
      key: 'tokens',
      label: t('usage_stats.total_tokens'),
      icon: <IconDiamond size={16} />,
      accent: '#8b5cf6',
      accentSoft: 'rgba(139, 92, 246, 0.18)',
      accentBorder: 'rgba(139, 92, 246, 0.35)',
      value: loading ? '-' : formatCompactNumber(usage?.total_tokens ?? 0),
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.cache_read_tokens')}:{' '}
            {loading ? '-' : formatCompactNumber(tokenBreakdown.cacheReadTokens)}
          </span>
          <span className={styles.statMetaItem}>
            {t('usage_stats.cache_write_tokens')}:{' '}
            {loading ? '-' : formatCompactNumber(tokenBreakdown.cacheWriteTokens)}
          </span>
          <span className={styles.statMetaItem}>
            {t('usage_stats.reasoning_tokens')}:{' '}
            {loading ? '-' : formatCompactNumber(tokenBreakdown.reasoningTokens)}
          </span>
          <span className={styles.statMetaItem} title={cacheHitHint}>
            {t('usage_stats.cache_hit_request_rate')}:{' '}
            {loading ? '-' : `${(tokenBreakdown.hitRate * 100).toFixed(1)}%`}
          </span>
        </>
      ),
      trend: sparklines.tokens,
    },
    {
      key: 'rpm',
      label: t('usage_stats.rpm_30m'),
      icon: <IconTimer size={16} />,
      accent: '#22c55e',
      accentSoft: 'rgba(34, 197, 94, 0.18)',
      accentBorder: 'rgba(34, 197, 94, 0.32)',
      value: loading ? '-' : formatPerMinuteValue(rateStats.rpm),
      meta: (
        <span className={styles.statMetaItem}>
          {t('usage_stats.total_requests')}:{' '}
          {loading ? '-' : rateStats.requestCount.toLocaleString()}
        </span>
      ),
      trend: sparklines.rpm,
    },
    {
      key: 'tpm',
      label: t('usage_stats.tpm_30m'),
      icon: <IconTrendingUp size={16} />,
      accent: '#f97316',
      accentSoft: 'rgba(249, 115, 22, 0.18)',
      accentBorder: 'rgba(249, 115, 22, 0.32)',
      value: loading ? '-' : formatPerMinuteValue(rateStats.tpm),
      meta: (
        <span className={styles.statMetaItem}>
          {t('usage_stats.total_tokens')}:{' '}
          {loading ? '-' : formatCompactNumber(rateStats.tokenCount)}
        </span>
      ),
      trend: sparklines.tpm,
    },
    {
      key: 'cost',
      label: t('usage_stats.total_cost'),
      icon: <IconDollarSign size={16} />,
      accent: '#f59e0b',
      accentSoft: 'rgba(245, 158, 11, 0.18)',
      accentBorder: 'rgba(245, 158, 11, 0.32)',
      value: loading ? '-' : hasCostData ? formatUsd(totalCost) : '--',
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.total_tokens')}:{' '}
            {loading ? '-' : formatCompactNumber(usage?.total_tokens ?? 0)}
          </span>
          {!hasCostData && (
            <span className={`${styles.statMetaItem} ${styles.statSubtle}`}>
              {t('usage_stats.cost_need_price')}
            </span>
          )}
        </>
      ),
      trend: hasCostData ? sparklines.cost : null,
    },
  ];

  return (
    <div className={styles.statsGrid}>
      {statsCards.map((card) => (
        <div
          key={card.key}
          className={styles.statCard}
          style={
            {
              '--accent': card.accent,
              '--accent-soft': card.accentSoft,
              '--accent-border': card.accentBorder,
            } as CSSProperties
          }
        >
          <div className={styles.statCardHeader}>
            <div className={styles.statLabelGroup}>
              <span className={styles.statLabel}>{card.label}</span>
            </div>
            <span className={styles.statIconBadge}>{card.icon}</span>
          </div>
          <div className={styles.statValue}>{card.value}</div>
          {card.meta && <div className={styles.statMetaRow}>{card.meta}</div>}
          <div className={styles.statTrend}>
            {card.trend ? (
              <Line
                className={styles.sparkline}
                data={card.trend.data}
                options={sparklineOptions}
              />
            ) : (
              <div className={styles.statTrendPlaceholder}></div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
