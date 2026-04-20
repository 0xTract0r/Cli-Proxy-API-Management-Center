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
  reauth_history?: AuthFileReauthHistoryEntry[];
  status_history?: AuthFileStatusHistoryEntry[];
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
}
