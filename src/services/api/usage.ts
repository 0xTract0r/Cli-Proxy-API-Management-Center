/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import { computeKeyStats, KeyStats } from '@/utils/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;

export interface UsageExportPayload {
  version?: number;
  exported_at?: string;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UsageImportResponse {
  added?: number;
  skipped?: number;
  total_requests?: number;
  failed_requests?: number;
  [key: string]: unknown;
}

export interface UsageQueryOptions {
  includeDetails?: boolean;
  since?: string | Date;
  detailLimit?: number;
}

export interface PricingSourceSnapshot {
  id?: string;
  label?: string;
  url?: string;
  status?: string;
  message?: string;
  last_refreshed_at?: string;
  model_count?: number;
}

export interface PricingCatalogModel {
  model?: string;
  display_name?: string;
  input_usd_per_mtok?: number;
  cached_input_usd_per_mtok?: number;
  output_usd_per_mtok?: number;
  cache_write_usd_per_mtok?: number;
  source?: string;
}

export interface PricingDetectedModel extends PricingCatalogModel {
  observed_model?: string;
  canonical_model?: string;
  pricing_status?: string;
}

export interface PricingOfficialSnapshot {
  last_refreshed_at?: string;
  persisted_at?: string;
  sources?: PricingSourceSnapshot[];
}

export interface UsagePricingSnapshot {
  official?: PricingOfficialSnapshot;
  models?: Record<string, PricingCatalogModel>;
  overrides?: Record<string, PricingCatalogModel>;
  detected_models?: PricingDetectedModel[];
}

export interface UsagePricingResponse {
  pricing?: UsagePricingSnapshot;
  warning?: string;
}

export interface PricingOverridePayload {
  model?: string;
  display_name?: string;
  input_usd_per_mtok: number;
  cached_input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  cache_write_usd_per_mtok: number;
}

const buildUsageQueryParams = (options: UsageQueryOptions = {}) => {
  const params: Record<string, string | number | boolean> = {};
  if (typeof options.includeDetails === 'boolean') {
    params.include_details = options.includeDetails;
  }
  if (options.since instanceof Date) {
    if (!Number.isNaN(options.since.getTime())) {
      params.since = options.since.toISOString();
    }
  } else if (typeof options.since === 'string' && options.since.trim()) {
    params.since = options.since.trim();
  }
  if (typeof options.detailLimit === 'number' && Number.isFinite(options.detailLimit)) {
    params.detail_limit = Math.max(1, Math.floor(options.detailLimit));
  }
  return Object.keys(params).length ? params : undefined;
};

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: (options: UsageQueryOptions = {}) =>
    apiClient.get<Record<string, unknown>>('/usage', {
      timeout: USAGE_TIMEOUT_MS,
      params: buildUsageQueryParams(options)
    }),

  /**
   * 导出使用统计快照
   */
  exportUsage: () => apiClient.get<UsageExportPayload>('/usage/export', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导入使用统计快照
   */
  importUsage: (payload: unknown) =>
    apiClient.post<UsageImportResponse>('/usage/import', payload, { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 获取 pricing snapshot
   */
  getPricing: () =>
    apiClient.get<UsagePricingResponse>('/usage/pricing', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 手动刷新官方 pricing
   */
  refreshPricing: () =>
    apiClient.post<UsagePricingResponse>('/usage/pricing/refresh', undefined, {
      timeout: USAGE_TIMEOUT_MS
    }),

  /**
   * 设置模型 override
   */
  upsertPricingOverride: (model: string, payload: PricingOverridePayload) =>
    apiClient.put<UsagePricingResponse>(
      `/usage/pricing/overrides/${encodeURIComponent(model)}`,
      payload,
      { timeout: USAGE_TIMEOUT_MS }
    ),

  /**
   * 删除模型 override
   */
  deletePricingOverride: (model: string) =>
    apiClient.delete<UsagePricingResponse>(
      `/usage/pricing/overrides/${encodeURIComponent(model)}`,
      { timeout: USAGE_TIMEOUT_MS }
    ),

  /**
   * 计算密钥成功/失败统计，必要时会先获取 usage 数据
   */
  async getKeyStats(usageData?: unknown): Promise<KeyStats> {
    let payload = usageData;
    if (!payload) {
      const response = await apiClient.get<Record<string, unknown>>('/usage', { timeout: USAGE_TIMEOUT_MS });
      payload = response?.usage ?? response;
    }
    return computeKeyStats(payload);
  }
};
