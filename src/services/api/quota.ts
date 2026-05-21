import { apiClient } from './client';

export type CoreQuotaSnapshotStatus =
  | 'ok'
  | 'error'
  | 'reauth_required'
  | 'refresh_disabled'
  | (string & {});

export interface CoreQuotaSnapshotEntry {
  auth_id?: string;
  auth_index?: string;
  name?: string;
  provider?: string;
  label?: string;
  disabled?: boolean;
  status?: CoreQuotaSnapshotStatus;
  error?: string;
  plan_type?: string;
  last_refreshed_at?: string;
  next_refresh_at?: string;
  snapshot?: Record<string, unknown>;
}

export interface CoreQuotaRefreshPolicy {
  enabled?: boolean;
  interval_seconds?: number | string;
  jitter_seconds?: number | string;
  startup_catch_up?: boolean;
  startup_max_staleness_seconds?: number | string;
  interval_minutes?: number | string;
  jitter_minutes?: number | string;
  startup_max_staleness_minutes?: number | string;
}

export interface CoreQuotaSnapshotsResponse {
  generated_at?: string;
  last_refreshed_at?: string;
  next_refresh_at?: string;
  policy?: CoreQuotaRefreshPolicy;
  refresh_policy?: CoreQuotaRefreshPolicy;
  entries?: CoreQuotaSnapshotEntry[];
}

export interface CoreQuotaRefreshRequest {
  auth_id?: string;
  name?: string;
  provider?: string;
}

const QUOTA_TIMEOUT_MS = 60 * 1000;

export const parseCoreQuotaTimestamp = (value?: string | null): Date | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /^0001-01-01(?:T|\b)/.test(trimmed)) return null;

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() <= 1) return null;
  return date;
};

export const quotaApi = {
  getSnapshots: () =>
    apiClient.get<CoreQuotaSnapshotsResponse>('/quota/snapshots', { timeout: QUOTA_TIMEOUT_MS }),

  refresh: (payload: CoreQuotaRefreshRequest = {}) =>
    apiClient.post<CoreQuotaSnapshotsResponse>('/quota/refresh', payload, {
      timeout: QUOTA_TIMEOUT_MS,
    }),
};
