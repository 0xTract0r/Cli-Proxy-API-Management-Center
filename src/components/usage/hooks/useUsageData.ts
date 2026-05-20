import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { USAGE_STATS_STALE_TIME_MS, useNotificationStore, useUsageStatsStore } from '@/stores';
import {
  usageApi,
  type PricingOverridePayload,
  type UsagePricingSnapshot
} from '@/services/api/usage';
import { downloadBlob } from '@/utils/download';
import type { ModelPrice } from '@/utils/usage';

export interface UsagePayload {
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  apis?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UseUsageDataReturn {
  usage: UsagePayload | null;
  loading: boolean;
  error: string;
  lastRefreshedAt: Date | null;
  modelPrices: Record<string, ModelPrice>;
  pricing: UsagePricingSnapshot | null;
  pricingLoading: boolean;
  pricingRefreshing: boolean;
  pricingError: string;
  loadUsage: () => Promise<void>;
  loadPricing: () => Promise<void>;
  refreshPricing: () => Promise<void>;
  savePricingOverride: (model: string, payload: PricingOverridePayload) => Promise<void>;
  deletePricingOverride: (model: string) => Promise<void>;
  handleExport: () => Promise<void>;
  handleImport: () => void;
  handleImportChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  exporting: boolean;
  importing: boolean;
}

export function useUsageData(): UseUsageDataReturn {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const usageSnapshot = useUsageStatsStore((state) => state.usage);
  const loading = useUsageStatsStore((state) => state.loading);
  const storeError = useUsageStatsStore((state) => state.error);
  const lastRefreshedAtTs = useUsageStatsStore((state) => state.lastRefreshedAt);
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);

  const [pricing, setPricing] = useState<UsagePricingSnapshot | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingRefreshing, setPricingRefreshing] = useState(false);
  const [pricingError, setPricingError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const loadUsage = useCallback(async () => {
    await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats]);

  const loadPricing = useCallback(async () => {
    setPricingLoading(true);
    setPricingError('');
    try {
      const response = await usageApi.getPricing();
      setPricing(response?.pricing ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setPricingError(message || t('usage_stats.pricing_load_failed'));
    } finally {
      setPricingLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS }).catch(() => {});
    void loadPricing().catch(() => {});
  }, [loadPricing, loadUsageStats]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await usageApi.exportUsage();
      const exportedAt =
        typeof data?.exported_at === 'string' ? new Date(data.exported_at) : new Date();
      const safeTimestamp = Number.isNaN(exportedAt.getTime())
        ? new Date().toISOString()
        : exportedAt.toISOString();
      const filename = `usage-export-${safeTimestamp.replace(/[:.]/g, '-')}.json`;
      downloadBlob({
        filename,
        blob: new Blob([JSON.stringify(data ?? {}, null, 2)], { type: 'application/json' })
      });
      showNotification(t('usage_stats.export_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setExporting(false);
    }
  };

  const handleImport = () => {
    importInputRef.current?.click();
  };

  const handleImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        showNotification(t('usage_stats.import_invalid'), 'error');
        return;
      }

      const result = await usageApi.importUsage(payload);
      showNotification(
        t('usage_stats.import_success', {
          added: result?.added ?? 0,
          skipped: result?.skipped ?? 0,
          total: result?.total_requests ?? 0,
          failed: result?.failed_requests ?? 0
        }),
        'success'
      );
      try {
        await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        showNotification(
          `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
          'error'
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('notification.upload_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setImporting(false);
    }
  };

  const refreshPricing = useCallback(async () => {
    setPricingRefreshing(true);
    setPricingError('');
    try {
      const response = await usageApi.refreshPricing();
      setPricing(response?.pricing ?? null);
      const warning = typeof response?.warning === 'string' ? response.warning.trim() : '';
      if (warning) {
        setPricingError(warning);
        showNotification(warning, 'warning');
      } else {
        showNotification(t('usage_stats.pricing_refresh_success'), 'success');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      const text = message || t('usage_stats.pricing_refresh_failed');
      setPricingError(text);
      showNotification(text, 'error');
    } finally {
      setPricingRefreshing(false);
    }
  }, [showNotification, t]);

  const savePricingOverride = useCallback(
    async (model: string, payload: PricingOverridePayload) => {
      const response = await usageApi.upsertPricingOverride(model, payload);
      setPricing(response?.pricing ?? null);
      showNotification(t('usage_stats.pricing_override_saved'), 'success');
    },
    [showNotification, t]
  );

  const deletePricingOverride = useCallback(
    async (model: string) => {
      const response = await usageApi.deletePricingOverride(model);
      setPricing(response?.pricing ?? null);
      showNotification(t('usage_stats.pricing_override_deleted'), 'success');
    },
    [showNotification, t]
  );

  const modelPrices = useMemo<Record<string, ModelPrice>>(() => {
    const detected = Array.isArray(pricing?.detected_models) ? pricing?.detected_models : [];
    const next: Record<string, ModelPrice> = {};

    detected.forEach((entry) => {
      const key = entry.observed_model?.trim();
      if (!key) {
        return;
      }
      const prompt = Number(entry.input_usd_per_mtok);
      const completion = Number(entry.output_usd_per_mtok);
      const cache =
        entry.cached_input_usd_per_mtok === undefined
          ? prompt
          : Number(entry.cached_input_usd_per_mtok);
      if (!Number.isFinite(prompt) || !Number.isFinite(completion) || !Number.isFinite(cache)) {
        return;
      }
      next[key] = { prompt, completion, cache };
    });

    return next;
  }, [pricing]);

  const usage = usageSnapshot as UsagePayload | null;
  const error = storeError || '';
  const lastRefreshedAt = lastRefreshedAtTs ? new Date(lastRefreshedAtTs) : null;

  return {
    usage,
    loading,
    error,
    lastRefreshedAt,
    modelPrices,
    pricing,
    pricingLoading,
    pricingRefreshing,
    pricingError,
    loadUsage,
    loadPricing,
    refreshPricing,
    savePricingOverride,
    deletePricingOverride,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing
  };
}
