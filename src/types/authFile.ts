/**
 * 认证文件相关类型
 * 基于原项目 src/modules/auth-files.js
 */

import type { RecentRequestBucket } from '@/utils/recentRequests';

export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'gemini'
  | 'gemini-cli'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'antigravity'
  | 'xai'
  | 'iflow'
  | 'vertex'
  | 'empty'
  | 'unknown';

export interface AuthFileReauthHistorySummary {
  file_sha256?: string;
  size?: number;
  modtime?: string;
  provider?: string;
  email?: string;
  plan?: string;
  project_id?: string;
  label?: string;
  account_id_hash?: string;
}

export interface AuthFileReauthHistoryEntry {
  event_type?: string;
  occurred_at?: string;
  provider?: string;
  target_auth_file?: string;
  overwrote_existing?: boolean;
  before?: AuthFileReauthHistorySummary;
  after?: AuthFileReauthHistorySummary;
  error?: string;
}

export type AuthFileStatusHistoryTrigger = 'manual' | 'auto';

export interface AuthFileStatusHistoryEntry {
  event_type?: string;
  occurred_at?: string;
  auth_name?: string;
  provider?: string;
  trigger?: AuthFileStatusHistoryTrigger | string;
  previous_status?: string;
  previous_message?: string;
  status?: string;
  status_message?: string;
  error?: string;
}

export type AuthFileHeaderMap = Record<string, string>;

/**
 * Snapshot of the core-managed identity projection for one account.
 *
 * 反关联模型（A/B + high-water）：
 *  - A 类「固定平台身份」：`stable_identity`（OS/Arch/X-App 等跨版本钉死的字段）。
 *  - B 类「高水位软件指纹」：`versioned_capabilities`（UA / package / runtime 版本，
 *    只升不降的 high-water）。
 *  - `runtime_fingerprint`：运行时环境信号（非身份钉死项）。
 * 字段名沿用 core projection，语义重定义为「身份投影」而非旧的「自动升级策略」。
 */
export interface AuthFileManagedHeaderProjection {
  generated_at?: string;
  source?: string;
  source_url?: string;
  checked_at?: string;
  completeness?: string;
  summary_headers?: AuthFileHeaderMap;
  versioned_capabilities?: AuthFileHeaderMap;
  stable_identity?: AuthFileHeaderMap;
  runtime_fingerprint?: AuthFileHeaderMap;
}

/**
 * 单条「身份变更审计」记录（重定义复用，非删除）。
 * 旧字段 `policy_version` 仍保留以兼容历史数据，但在 UI 上呈现为 high-water
 * 版本快照标识，不再使用「自动升级策略版本」措辞。
 */
export interface AuthFileManagedHeaderHistoryEntry {
  recorded_at?: string;
  /** Compat field from older core payloads; surfaced as a high-water snapshot marker. */
  policy_version?: string;
  reason?: string;
  source?: string;
  source_url?: string;
  changed_fields?: string[];
  /** core 实际下发的来源字段（managed_header_state.history）。 */
  previous_source?: string;
  previous_source_url?: string;
  next_source?: string;
  next_source_url?: string;
  previous_summary_headers?: AuthFileHeaderMap;
  next_summary_headers?: AuthFileHeaderMap;
  previous_versioned_capabilities?: AuthFileHeaderMap;
  next_versioned_capabilities?: AuthFileHeaderMap;
  /** A 类钉死平台身份快照；diff 非空时该条目属于身份模型变更而非例行版本刷新。 */
  previous_stable_identity?: AuthFileHeaderMap;
  next_stable_identity?: AuthFileHeaderMap;
  previous_runtime_fingerprint?: AuthFileHeaderMap;
  next_runtime_fingerprint?: AuthFileHeaderMap;
  previous?: Record<string, unknown>;
  next?: Record<string, unknown>;
}

/**
 * 身份投影 + 身份变更审计历史。`history` 重定义复用为「身份变更审计」视图数据源。
 */
export interface AuthFileManagedHeaderState {
  /** Compat field from older core payloads; not shown as an upgrade-policy version. */
  policy_version?: string;
  current?: AuthFileManagedHeaderProjection | null;
  history?: AuthFileManagedHeaderHistoryEntry[];
}

export interface AuthFileClientVersionObservation {
  user_agent?: string;
  version?: string;
  package_version?: string;
  runtime_version?: string;
  os?: string;
  arch?: string;
  source?: string | Record<string, unknown>;
  first_seen_at?: string;
  last_seen_at?: string;
  request_count?: number;
}

export interface AuthFileAccountSettingsActivation {
  summary: string;
  state?: string;
  source?: string;
  effective?: boolean;
}

export interface AuthFileAccountSettings {
  proxy_url: string;
  note: string;
  disabled: boolean;
  managed_headers: AuthFileHeaderMap;
  extra_headers: AuthFileHeaderMap;
  refresh_enabled: boolean;
  transport_profile: string | Record<string, unknown> | null;
  tls_profile: string | Record<string, unknown> | null;
  runtime_profile?: Record<string, unknown> | null;
  runtime_identity?: Record<string, unknown> | null;
  /**
   * 只读、脱敏的每账号合成 device_id（来自 ①）。
   * 格式为「前 16 位小写 hex + …(U+2026)」；后端 `omitempty`，auth 缺失或派生空时缺省。
   * 仅用于展示，不可写、不进 PATCH。
   */
  synthetic_device_id?: string;
  managed_header_state?: AuthFileManagedHeaderState | null;
  client_version_observations?: AuthFileClientVersionObservation[];
  activation: AuthFileAccountSettingsActivation;
  warnings: string[];
}

export interface AuthFileAccountSettingsResponse {
  name?: string;
  account_settings?: Partial<AuthFileAccountSettings> | null;
  [key: string]: unknown;
}

export interface AuthFileAccountSettingsPatchRequest {
  name: string;
  proxy_url: string | null;
  note: string | null;
  disabled: boolean;
  extra_headers: AuthFileHeaderMap;
  refresh_enabled: boolean;
  transport_profile: string | Record<string, unknown> | null;
  tls_profile: string | Record<string, unknown> | null;
}

export interface AuthFileItem {
  name: string;
  type?: AuthFileType | string;
  provider?: string;
  size?: number;
  authIndex?: string | number | null;
  runtimeOnly?: boolean | string;
  disabled?: boolean;
  unavailable?: boolean;
  status?: string;
  statusMessage?: string;
  lastRefresh?: string | number;
  modified?: number;
  note?: string;
  proxy_url?: string;
  headers?: AuthFileHeaderMap;
  account_settings?: AuthFileAccountSettings;
  accountSettings?: AuthFileAccountSettings;
  reauth_history?: AuthFileReauthHistoryEntry[];
  status_history?: AuthFileStatusHistoryEntry[];
  cyber_policy_flag_count?: number;
  last_cyber_policy_at?: string;
  success?: unknown;
  failed?: unknown;
  recent_requests?: RecentRequestBucket[];
  recentRequests?: RecentRequestBucket[];
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
}
