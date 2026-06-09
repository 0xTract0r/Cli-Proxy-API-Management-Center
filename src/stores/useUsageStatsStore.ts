import { create } from 'zustand';
import { usageApi, type UsageQueryOptions } from '@/services/api';
import { useAuthStore } from '@/stores/useAuthStore';
import { collectUsageDetails, computeKeyStatsFromDetails, type KeyStats, type UsageDetail } from '@/utils/usage';
import { createPreviewSampleUsage, isPreviewSampleUsageEnabled } from '@/utils/usagePreview';
import i18n from '@/i18n';

export const USAGE_STATS_STALE_TIME_MS = 240_000;

export type LoadUsageStatsOptions = {
  force?: boolean;
  staleTimeMs?: number;
  includeDetails?: boolean;
  since?: string | Date;
  detailLimit?: number;
};

type UsageStatsSnapshot = Record<string, unknown>;

type UsageStatsState = {
  usage: UsageStatsSnapshot | null;
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  loading: boolean;
  error: string | null;
  lastRefreshedAt: number | null;
  scopeKey: string;
  requestKey: string;
  loadUsageStats: (options?: LoadUsageStatsOptions) => Promise<void>;
  clearUsageStats: () => void;
};

const createEmptyKeyStats = (): KeyStats => ({ bySource: {}, byAuthIndex: {} });

let usageRequestToken = 0;
let inFlightUsageRequest: {
  id: number;
  scopeKey: string;
  requestKey: string;
  promise: Promise<void>;
} | null = null;

const getErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : i18n.t('usage_stats.loading_error');

const resolveUsageSnapshot = (usage: UsageStatsSnapshot | null) => {
  const usageDetails = collectUsageDetails(usage);
  if (usageDetails.length > 0 || !isPreviewSampleUsageEnabled()) {
    return { usage, usageDetails };
  }

  const previewUsage = createPreviewSampleUsage();
  return {
    usage: previewUsage,
    usageDetails: collectUsageDetails(previewUsage),
  };
};

const normalizeUsageQueryOptions = (options: LoadUsageStatsOptions): UsageQueryOptions => {
  const query: UsageQueryOptions = {};
  if (typeof options.includeDetails === 'boolean') {
    query.includeDetails = options.includeDetails;
  }
  if (options.since instanceof Date) {
    if (!Number.isNaN(options.since.getTime())) {
      query.since = options.since.toISOString();
    }
  } else if (typeof options.since === 'string' && options.since.trim()) {
    query.since = options.since.trim();
  }
  if (typeof options.detailLimit === 'number' && Number.isFinite(options.detailLimit)) {
    query.detailLimit = Math.max(1, Math.floor(options.detailLimit));
  }
  return query;
};

const usageQueryKey = (query: UsageQueryOptions): string =>
  JSON.stringify({
    includeDetails: query.includeDetails ?? null,
    since: query.since ?? null,
    detailLimit: query.detailLimit ?? null
  });

export const useUsageStatsStore = create<UsageStatsState>((set, get) => ({
  usage: null,
  keyStats: createEmptyKeyStats(),
  usageDetails: [],
  loading: false,
  error: null,
  lastRefreshedAt: null,
  scopeKey: '',
  requestKey: '',

  loadUsageStats: async (options = {}) => {
    const force = options.force === true;
    const staleTimeMs = options.staleTimeMs ?? USAGE_STATS_STALE_TIME_MS;
    const queryOptions = normalizeUsageQueryOptions(options);
    const requestKey = usageQueryKey(queryOptions);
    const { apiBase = '', managementKey = '' } = useAuthStore.getState();
    const scopeKey = `${apiBase}::${managementKey}`;
    const state = get();
    const scopeChanged = state.scopeKey !== scopeKey;

    // 先复用同源 in-flight 请求，避免多个页面同时发起重复 /usage。
    if (
      inFlightUsageRequest &&
      inFlightUsageRequest.scopeKey === scopeKey &&
      inFlightUsageRequest.requestKey === requestKey
    ) {
      await inFlightUsageRequest.promise;
      return;
    }

    // 连接目标变化时，旧请求结果必须失效。
    if (
      inFlightUsageRequest &&
      (inFlightUsageRequest.scopeKey !== scopeKey ||
        inFlightUsageRequest.requestKey !== requestKey)
    ) {
      usageRequestToken += 1;
      inFlightUsageRequest = null;
    }

    const fresh =
      !scopeChanged &&
      state.requestKey === requestKey &&
      state.lastRefreshedAt !== null &&
      Date.now() - state.lastRefreshedAt < staleTimeMs;

    if (!force && fresh) {
      return;
    }

    if (scopeChanged) {
      set({
        usage: null,
        keyStats: createEmptyKeyStats(),
        usageDetails: [],
        error: null,
        lastRefreshedAt: null,
        scopeKey,
        requestKey
      });
    }

    const requestId = (usageRequestToken += 1);
    set({ loading: true, error: null, scopeKey, requestKey });

    const requestPromise = (async () => {
      try {
        const usageResponse = await usageApi.getUsage(queryOptions);
        const rawUsage = usageResponse?.usage ?? usageResponse;
        const usage =
          rawUsage && typeof rawUsage === 'object' ? (rawUsage as UsageStatsSnapshot) : null;
        const resolvedUsage = resolveUsageSnapshot(usage);

        if (requestId !== usageRequestToken) return;

        set({
          usage: resolvedUsage.usage,
          keyStats: computeKeyStatsFromDetails(resolvedUsage.usageDetails),
          usageDetails: resolvedUsage.usageDetails,
          loading: false,
          error: null,
          lastRefreshedAt: Date.now(),
          scopeKey,
          requestKey
        });
      } catch (error: unknown) {
        if (requestId !== usageRequestToken) return;
        if (isPreviewSampleUsageEnabled()) {
          const previewUsage = createPreviewSampleUsage();
          const usageDetails = collectUsageDetails(previewUsage);
          set({
            usage: previewUsage,
            keyStats: computeKeyStatsFromDetails(usageDetails),
            usageDetails,
            loading: false,
            error: null,
            lastRefreshedAt: Date.now(),
            scopeKey,
            requestKey
          });
          return;
        }
        const message = getErrorMessage(error);
        set({
          loading: false,
          error: message,
          scopeKey,
          requestKey
        });
        throw new Error(message);
      } finally {
        if (inFlightUsageRequest?.id === requestId) {
          inFlightUsageRequest = null;
        }
      }
    })();

    inFlightUsageRequest = { id: requestId, scopeKey, requestKey, promise: requestPromise };
    await requestPromise;
  },

  clearUsageStats: () => {
    usageRequestToken += 1;
    inFlightUsageRequest = null;
    set({
      usage: null,
      keyStats: createEmptyKeyStats(),
      usageDetails: [],
      loading: false,
      error: null,
      lastRefreshedAt: null,
      scopeKey: '',
      requestKey: ''
    });
  }
}));
