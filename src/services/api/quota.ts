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
  status?: CoreQuotaSnapshotStatus;
  error?: string;
  plan_type?: string;
  last_refreshed_at?: string;
  next_refresh_at?: string;
  snapshot?: Record<string, unknown>;
}

export interface CoreQuotaSnapshotsResponse {
  generated_at?: string;
  entries?: CoreQuotaSnapshotEntry[];
}

export interface CoreQuotaRefreshRequest {
  auth_id?: string;
  name?: string;
  provider?: string;
}

const QUOTA_TIMEOUT_MS = 60 * 1000;

export const quotaApi = {
  getSnapshots: () =>
    apiClient.get<CoreQuotaSnapshotsResponse>('/quota/snapshots', { timeout: QUOTA_TIMEOUT_MS }),

  refresh: (payload: CoreQuotaRefreshRequest = {}) =>
    apiClient.post<CoreQuotaSnapshotsResponse>('/quota/refresh', payload, {
      timeout: QUOTA_TIMEOUT_MS
    })
};
