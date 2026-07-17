import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { farmApi } from '@/services/api/farm';
import { useFarmStore } from '@/stores';
import type {
  FarmContainerDetailView,
  FarmKeepaliveSeriesResponse,
  FarmResourceSeriesResponse,
} from '@/types/farm';

export interface UseFarmContainerDetailResult {
  detail: FarmContainerDetailView | null;
  keepalive: FarmKeepaliveSeriesResponse | null;
  resources: FarmResourceSeriesResponse | null;
  loading: boolean;
  /** 仅覆盖 getContainerDetail（主详情）失败；只有它失败才应该让整个抽屉落 error 态。 */
  error: string;
  /** 心跳时序独立失败态，不连累主详情或资源时序。 */
  keepaliveError: string;
  /** 资源时序独立失败态，不连累主详情或心跳时序。 */
  resourcesError: string;
  reload: () => Promise<void>;
}

// 详情抽屉时序窗口：近 24h、1h 分桶——与 httpapi/observability.go
// enrichContainerView 计算 SuccessRate24h/NextKeepaliveEstimate 用的
// keepaliveObservedIntervalBucketStep（1h）保持一致口径，避免抽屉里的图表
// 分桶宽度和列表页 24h 成功率的统计口径对不上。
const DETAIL_SERIES_WINDOW = '24h';
const DETAIL_SERIES_STEP = '1h';

/**
 * 容器详情抽屉数据源：GET /api/farm/containers/{id} 聚合详情 +
 * .../keepalive + .../resources 两条时序（design.md 决策4/6，tasks.md P0-9
 * <FarmContainerDetail>）。containerId=null（抽屉未打开）时不发请求。
 *
 * 三个请求并行发起（Promise.allSettled），各自独立捕获错误、互不连累：
 * getContainerDetail 成功即可打开抽屉并渲染主详情，即便 keepalive/
 * resources 其中一条 reject（网络抖动/鉴权/500）；那一条只把自己的
 * `keepaliveError`/`resourcesError` 置位，供 <FarmContainerDetail> 在对应
 * 图表区块单独展示错误态，不影响已成功的主详情或另一条时序。只有
 * getContainerDetail 自身失败才通过 `error` 让整个抽屉落 error 态（见
 * <FarmContainerDetail> 用 AsyncPanel 包裹主详情）。
 *
 * 注：telemetry 未装配时 keepalive/resources 会返回空 buckets 而非
 * error，属于正常空态，不会走到这里的 error 分支。
 */
export function useFarmContainerDetail(containerId: string | null): UseFarmContainerDetailResult {
  const { t } = useTranslation();
  const isConfigured = useFarmStore((state) => state.isConfigured);
  const [detail, setDetail] = useState<FarmContainerDetailView | null>(null);
  const [keepalive, setKeepalive] = useState<FarmKeepaliveSeriesResponse | null>(null);
  const [resources, setResources] = useState<FarmResourceSeriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [keepaliveError, setKeepaliveError] = useState('');
  const [resourcesError, setResourcesError] = useState('');

  const reload = useCallback(async () => {
    if (!isConfigured || !containerId) {
      setDetail(null);
      setKeepalive(null);
      setResources(null);
      setError('');
      setKeepaliveError('');
      setResourcesError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setKeepaliveError('');
    setResourcesError('');

    const [detailResult, keepaliveResult, resourcesResult] = await Promise.allSettled([
      farmApi.getContainerDetail(containerId),
      farmApi.getContainerKeepalive(containerId, {
        window: DETAIL_SERIES_WINDOW,
        step: DETAIL_SERIES_STEP,
      }),
      farmApi.getContainerResources(containerId, {
        window: DETAIL_SERIES_WINDOW,
        step: DETAIL_SERIES_STEP,
      }),
    ]);

    const toMessage = (reason: unknown) =>
      reason instanceof Error ? reason.message : t('farm.error.load_failed');

    if (detailResult.status === 'fulfilled') {
      setDetail(detailResult.value ?? null);
    } else {
      setDetail(null);
      setError(toMessage(detailResult.reason));
    }

    if (keepaliveResult.status === 'fulfilled') {
      setKeepalive(keepaliveResult.value ?? null);
    } else {
      setKeepalive(null);
      setKeepaliveError(toMessage(keepaliveResult.reason));
    }

    if (resourcesResult.status === 'fulfilled') {
      setResources(resourcesResult.value ?? null);
    } else {
      setResources(null);
      setResourcesError(toMessage(resourcesResult.reason));
    }

    setLoading(false);
  }, [containerId, isConfigured, t]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId, isConfigured]);

  return { detail, keepalive, resources, loading, error, keepaliveError, resourcesError, reload };
}
