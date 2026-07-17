import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { AsyncPanel } from '@/components/ui/AsyncPanel';
import { DataState } from '@/components/ui/DataState';
import { HealthPill, type HealthPillStatus } from '@/components/ui/HealthPill';
import type { FarmContainerView, FarmEventView } from '@/types/farm';
import { formatDateTimeUtc8 } from '@/utils/datetime';
import { formatFileSize } from '@/utils/format';
import { formatDurationMs } from '@/utils/usage/latency';
import { useFarmContainerDetail } from '../hooks/useFarmContainerDetail';
import {
  deviceAlignmentToBadgeVariant,
  healthReasonToFarmHealthVariant,
  pctToFarmHealthVariant,
  successRateToFarmHealthVariant,
  type FarmHealthVariant,
} from '../utils/health';
// 注：FarmHealthVariant ('ok'|'warn'|'err'|'idle') 与 HealthPillStatus 字面量
// 集合逐字相同，下方直接把 healthReasonToFarmHealthVariant 等函数的返回值
// 传给 <HealthPill status=...>，不需要额外映射表/类型断言。
import {
  mapSeriesToPoints,
  segmentToAreaPath,
  segmentToPolylinePoints,
  splitIntoSegments,
} from '../utils/chart';
import styles from './FarmContainerDetail.module.scss';

interface FarmContainerDetailProps {
  container: FarmContainerView | null;
  onClose: () => void;
}

const CHART_WIDTH = 320;
const CHART_HEIGHT = 64;

const SEVERITY_TO_PILL: Record<FarmEventView['severity'], HealthPillStatus> = {
  critical: 'err',
  warning: 'warn',
  info: 'idle',
};

function formatPct(pct: number | undefined): string {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return '—';
  return `${pct.toFixed(1)}%`;
}

/**
 * 容器详情抽屉（design.md 决策6，tasks.md P0-9）：行点击打开，聚合心跳/
 * 资源时序、生效间隔估算、device_id 对齐、探针 token 趋势（标注非账单）与
 * 事件时间线。设计系统当前没有独立 Drawer 组件，复用既有 <Modal> 并通过
 * `className` 定制为右侧抽屉视觉（见 .module.scss `:global(.modal)`
 * 覆盖），不新增裸的模态基础组件。
 *
 * 三条底层请求（主详情/心跳时序/资源时序）用 Promise.allSettled 并行发起、
 * 独立捕获错误（见 useFarmContainerDetail）：只要主详情成功就打开抽屉正常
 * 渲染，心跳或资源时序其中一条失败只让对应图表区块落 block 级 error 态
 * （<DataState variant="error">），不连累已成功的主详情或另一条时序。
 */
export function FarmContainerDetail({ container, onClose }: FarmContainerDetailProps) {
  const { t, i18n } = useTranslation();
  const containerId = container?.id ?? null;
  const { detail, keepalive, resources, loading, error, keepaliveError, resourcesError } =
    useFarmContainerDetail(containerId);

  const successRatePoints = useMemo(() => {
    const values = (keepalive?.buckets ?? []).map((b) =>
      b.sample_count > 0 ? b.success_rate * 100 : null
    );
    return mapSeriesToPoints(values, CHART_WIDTH, CHART_HEIGHT, { min: 0, max: 100 });
  }, [keepalive]);

  const latencyPoints = useMemo(() => {
    const values = (keepalive?.buckets ?? []).map((b) => b.avg_latency_ms ?? null);
    return mapSeriesToPoints(values, CHART_WIDTH, CHART_HEIGHT);
  }, [keepalive]);

  const memPoints = useMemo(() => {
    const values = (resources?.buckets ?? []).map((b) => b.avg_mem_bytes ?? null);
    return mapSeriesToPoints(values, CHART_WIDTH, CHART_HEIGHT);
  }, [resources]);

  const cpuPoints = useMemo(() => {
    const values = (resources?.buckets ?? []).map((b) => b.avg_cpu_pct ?? null);
    return mapSeriesToPoints(values, CHART_WIDTH, CHART_HEIGHT, { min: 0, max: 100 });
  }, [resources]);

  const open = Boolean(container);
  const healthVariant = healthReasonToFarmHealthVariant(detail?.health_reason);
  const successRate24hVariant = successRateToFarmHealthVariant(detail?.success_rate_24h);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        container ? (
          <div className={styles.titleRow}>
            <span className={styles.titleId}>{container.id}</span>
            <span className={styles.titleMasked}>{container.device_id_masked}</span>
          </div>
        ) : undefined
      }
      width={720}
      className={styles.drawer}
    >
      {!container ? null : (
        <div className={styles.body} data-testid={`farm-container-detail-${container.id}`}>
          <AsyncPanel
            loading={loading}
            error={error}
            loadingLabel={t('common.loading')}
            loadingTestId="farm-container-detail-loading"
            errorTestId="farm-container-detail-error"
          >
            {!detail ? null : (
              <>
                {/* 健康摘要 */}
                <section className={styles.section} data-testid="farm-detail-health">
                  <h3 className={styles.sectionTitle}>
                    {t('farm.detail.healthSection', { defaultValue: '健康状态' })}
                  </h3>
                  <div className={styles.healthRow}>
                    <HealthPill
                      status={healthVariant}
                      label={t(`farm.status.${detail.status}`, { defaultValue: detail.status })}
                      data-testid="farm-detail-status-pill"
                    />
                    <span className={styles.reasonText}>
                      {t(`farm.healthReason.${detail.health_reason ?? ''}`, {
                        defaultValue: detail.health_reason || '—',
                      })}
                    </span>
                  </div>
                </section>

                {/* 心跳 sparkline + latency */}
                <section className={styles.section} data-testid="farm-detail-keepalive">
                  <h3 className={styles.sectionTitle}>
                    {t('farm.detail.keepaliveSection', {
                      defaultValue: '心跳成功率与延迟（近24h，1h 分桶）',
                    })}
                  </h3>
                  {keepaliveError ? (
                    <DataState
                      variant="error"
                      message={keepaliveError}
                      testId="farm-detail-keepalive-error"
                    />
                  ) : (
                    <>
                      <div className={styles.chartRow}>
                        <div className={styles.chartCol}>
                          <span className={styles.chartLabel}>
                            {t('farm.detail.successRate', { defaultValue: '成功率' })}{' '}
                            <span
                              className={styles.chartValueBadge}
                              data-variant={successRate24hVariant}
                            >
                              {typeof detail.success_rate_24h === 'number'
                                ? `${(detail.success_rate_24h * 100).toFixed(1)}%`
                                : '—'}
                            </span>
                          </span>
                          <SparklineChart
                            segments={splitIntoSegments(successRatePoints)}
                            testId="farm-detail-success-rate-chart"
                          />
                        </div>
                        <div className={styles.chartCol}>
                          <span className={styles.chartLabel}>
                            {t('farm.detail.avgLatency', { defaultValue: '平均延迟 (ms)' })}
                          </span>
                          <SparklineChart
                            segments={splitIntoSegments(latencyPoints)}
                            testId="farm-detail-latency-chart"
                          />
                        </div>
                      </div>
                      {(keepalive?.buckets.length ?? 0) === 0 ? (
                        <p className={styles.hintText}>
                          {t('farm.detail.noKeepaliveSamples', {
                            defaultValue: '窗口内无心跳样本（空窗口是正常返回，不代表出错）。',
                          })}
                        </p>
                      ) : null}
                    </>
                  )}
                </section>

                {/* 生效间隔配置 + 下次估算 */}
                <section className={styles.section} data-testid="farm-detail-next-estimate">
                  <h3 className={styles.sectionTitle}>
                    {t('farm.detail.nextEstimateSection', { defaultValue: '下次探针估算' })}
                  </h3>
                  {detail.next_keepalive_estimate ? (
                    <div className={styles.estimateBox}>
                      <span>
                        {t('farm.detail.estimateRange', { defaultValue: '配置区间' })}:{' '}
                        {formatDurationMs(detail.next_keepalive_estimate.min_seconds * 1000, {
                          maxUnits: 1,
                        })}{' '}
                        ~{' '}
                        {formatDurationMs(detail.next_keepalive_estimate.max_seconds * 1000, {
                          maxUnits: 1,
                        })}{' '}
                        (
                        {t('farm.detail.estimateBase', { defaultValue: '基准' })}{' '}
                        {formatDurationMs(detail.next_keepalive_estimate.base_seconds * 1000, {
                          maxUnits: 1,
                        })}
                        )
                      </span>
                      <span>
                        {t('farm.detail.estimateObserved', { defaultValue: '近24h实测均值' })}:{' '}
                        {typeof detail.next_keepalive_estimate.avg_observed_seconds_24h === 'number'
                          ? formatDurationMs(
                              detail.next_keepalive_estimate.avg_observed_seconds_24h * 1000,
                              { maxUnits: 1 }
                            )
                          : t('farm.overview.pendingP1', { defaultValue: '—/待P1' })}
                      </span>
                      <p className={styles.hintText}>{detail.next_keepalive_estimate.note}</p>
                    </div>
                  ) : (
                    <p className={styles.hintText}>
                      {t('farm.detail.noEstimate', {
                        defaultValue: '该状态不再有下一次探针（非 running/degraded 容器）。',
                      })}
                    </p>
                  )}
                </section>

                {/* 资源 area 图 */}
                <section className={styles.section} data-testid="farm-detail-resources">
                  <h3 className={styles.sectionTitle}>
                    {t('farm.detail.resourcesSection', {
                      defaultValue: '资源占用（近24h，1h 分桶）',
                    })}
                  </h3>
                  {resourcesError ? (
                    <DataState
                      variant="error"
                      message={resourcesError}
                      testId="farm-detail-resources-error"
                    />
                  ) : (
                    <>
                      <div className={styles.chartRow}>
                        <div className={styles.chartCol}>
                          <span className={styles.chartLabel}>
                            {t('farm.resources.mem', { defaultValue: '内存' })}
                            {detail.latest_resource?.mem_used_bytes !== undefined
                              ? ` · ${formatFileSize(detail.latest_resource.mem_used_bytes)}`
                              : ''}
                          </span>
                          <AreaChart
                            segments={splitIntoSegments(memPoints)}
                            testId="farm-detail-mem-chart"
                          />
                        </div>
                        <div className={styles.chartCol}>
                          <span className={styles.chartLabel}>
                            {t('farm.resources.cpu', { defaultValue: 'CPU' })}
                            {typeof detail.latest_resource?.cpu_pct === 'number'
                              ? ` · ${formatPct(detail.latest_resource.cpu_pct)}`
                              : ''}
                          </span>
                          <AreaChart
                            segments={splitIntoSegments(cpuPoints)}
                            testId="farm-detail-cpu-chart"
                            variant={pctToFarmHealthVariant(detail.latest_resource?.cpu_pct)}
                          />
                        </div>
                      </div>
                      {(resources?.buckets.length ?? 0) === 0 ? (
                        <p className={styles.hintText}>
                          {t('farm.detail.noResourceSamples', {
                            defaultValue: '窗口内无资源样本（空窗口是正常返回，不代表出错）。',
                          })}
                        </p>
                      ) : null}
                    </>
                  )}
                </section>

                {/* device_id 对齐卡 */}
                <section className={styles.section} data-testid="farm-detail-device-id">
                  <h3 className={styles.sectionTitle}>
                    {t('farm.detail.deviceIdSection', { defaultValue: 'device_id 对齐' })}
                  </h3>
                  <div className={styles.deviceIdRow}>
                    <span
                      className={`status-badge ${deviceAlignmentToBadgeVariant(detail.device_id_alignment)}`}
                    >
                      {t(
                        `auth_files.account_settings_device_id_source_${detail.device_id_alignment ?? 'unknown'}`,
                        { defaultValue: detail.device_id_alignment ?? t('farm.accountHealth.unbound') }
                      )}
                    </span>
                    <span className={styles.mono}>{detail.device_id_masked}</span>
                  </div>
                  <p className={styles.hintText}>
                    {t('farm.detail.deviceIdDriftGap', {
                      defaultValue:
                        '漂移历史时间线属于 P1（container_deviceid_checks 迁移，暂未落地），这里只展示当前一次对齐判定，不是完整历史。',
                    })}
                  </p>
                </section>

                {/* 探针 token 趋势 */}
                <section className={styles.section} data-testid="farm-detail-probe-tokens">
                  <h3 className={styles.sectionTitle}>
                    {t('farm.detail.probeTokenSection', { defaultValue: '探针 token 趋势' })}
                  </h3>
                  <p className={styles.probeTokenBadge}>
                    {t('farm.detail.probeTokenNotBilling', {
                      defaultValue: '探针 token ≠ 账单：这里只反映保活探针自身消耗，不是账号真实计费用量。',
                    })}
                  </p>
                  <p className={styles.hintText}>
                    {t('farm.detail.probeTokenGap', {
                      defaultValue:
                        '本轮聚合读取路径未接入 tokens_total 求和（见交付说明 gaps），暂无法诚实展示趋势图，待 P1/store 层补聚合列后接入。',
                    })}
                  </p>
                </section>

                {/* 状态/告警事件时间线 */}
                <section className={styles.section} data-testid="farm-detail-events">
                  <h3 className={styles.sectionTitle}>
                    {t('farm.detail.eventsSection', { defaultValue: '状态 / 告警事件' })}
                  </h3>
                  {detail.open_events.length === 0 ? (
                    <p className={styles.hintText}>
                      {t('farm.detail.noOpenEvents', { defaultValue: '当前没有仍在 firing 的事件。' })}
                    </p>
                  ) : (
                    <ul className={styles.eventList}>
                      {detail.open_events.map((event) => (
                        <li key={event.id} className={styles.eventItem}>
                          <HealthPill
                            status={SEVERITY_TO_PILL[event.severity]}
                            label={t(`farm.healthReason.${event.reason}`, {
                              defaultValue: event.reason,
                            })}
                          />
                          <span className={styles.mono}>{formatDateTimeUtc8(event.ts, i18n.language)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className={styles.hintText}>
                    {t('farm.detail.eventsHistoryGap', {
                      defaultValue: '只展示当前仍 firing 的事件，暂非完整历史时间线（见交付说明 gaps）。',
                    })}
                  </p>
                </section>
              </>
            )}
          </AsyncPanel>
        </div>
      )}
    </Modal>
  );
}

function SparklineChart({
  segments,
  testId,
}: {
  segments: ReturnType<typeof splitIntoSegments>;
  testId: string;
}) {
  if (segments.length === 0) {
    return (
      <svg
        width={CHART_WIDTH}
        height={CHART_HEIGHT}
        className={styles.chartSvg}
        data-testid={testId}
        role="img"
        aria-label=""
      />
    );
  }
  return (
    <svg
      width={CHART_WIDTH}
      height={CHART_HEIGHT}
      className={styles.chartSvg}
      data-testid={testId}
      role="img"
      aria-hidden="true"
    >
      {segments.map((segment, i) => (
        <polyline
          key={i}
          points={segmentToPolylinePoints(segment)}
          fill="none"
          className={styles.sparklineStroke}
        />
      ))}
    </svg>
  );
}

function AreaChart({
  segments,
  testId,
  variant,
}: {
  segments: ReturnType<typeof splitIntoSegments>;
  testId: string;
  variant?: FarmHealthVariant;
}) {
  return (
    <svg
      width={CHART_WIDTH}
      height={CHART_HEIGHT}
      className={styles.chartSvg}
      data-testid={testId}
      data-variant={variant}
      role="img"
      aria-hidden="true"
    >
      {segments.map((segment, i) => {
        const path = segmentToAreaPath(segment, CHART_HEIGHT);
        if (!path) return null;
        return <path key={i} d={path} className={styles.areaFill} />;
      })}
    </svg>
  );
}
