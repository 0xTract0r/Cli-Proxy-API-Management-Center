/**
 * 认证文件相关类型
 * 基于原项目 src/modules/auth-files.js
 */

export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'gemini'
  | 'gemini-cli'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'antigravity'
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

export interface AuthFileManagedHeaderHistoryEntry {
  recorded_at?: string;
  policy_version?: string;
  reason?: string;
  source?: string;
  source_url?: string;
  changed_fields?: string[];
  previous_versioned_capabilities?: AuthFileHeaderMap;
  next_versioned_capabilities?: AuthFileHeaderMap;
  previous?: Record<string, unknown>;
  next?: Record<string, unknown>;
}

export interface AuthFileManagedHeaderState {
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
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
}
