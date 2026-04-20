/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';

export type OAuthProvider =
  | 'codex'
  | 'anthropic'
  | 'antigravity'
  | 'gemini-cli'
  | 'iflow'
  | 'kimi'
  | 'qwen';

export interface OAuthStartResponse {
  url: string;
  state?: string;
}

export interface OAuthReauthHistoryFileSummary {
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

export interface OAuthReauthHistoryEvent {
  event_type: string;
  occurred_at: string;
  provider?: string;
  target_auth_file?: string;
  overwrote_existing?: boolean;
  before?: OAuthReauthHistoryFileSummary;
  after?: OAuthReauthHistoryFileSummary;
  error?: string;
}

export interface OAuthReauthHistoryResponse {
  events: OAuthReauthHistoryEvent[];
  limit?: number;
  auth_name?: string;
}

export type OAuthSessionStatus = 'ok' | 'wait' | 'error' | 'cancelled';

export interface OAuthStatusResponse {
  status: OAuthSessionStatus;
  error?: string;
}

export interface OAuthCancelResponse {
  status: 'ok' | 'error';
  cancelled?: boolean;
  error?: string;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

export interface IFlowCookieAuthResponse {
  status: 'ok' | 'error';
  error?: string;
  saved_path?: string;
  email?: string;
  expired?: string;
  type?: string;
}

const WEBUI_SUPPORTED: OAuthProvider[] = ['codex', 'anthropic', 'antigravity', 'gemini-cli', 'iflow'];
const CALLBACK_PROVIDER_MAP: Partial<Record<OAuthProvider, string>> = {
  'gemini-cli': 'gemini'
};

export const isOAuthCancelSuccessful = (response: OAuthCancelResponse) =>
  response.status === 'ok' && response.cancelled !== false;

export const oauthApi = {
  startAuth: (provider: OAuthProvider, options?: { projectId?: string; authName?: string }) => {
    const params: Record<string, string | boolean> = {};
    if (WEBUI_SUPPORTED.includes(provider)) {
      params.is_webui = true;
    }
    if (provider === 'gemini-cli' && options?.projectId) {
      params.project_id = options.projectId;
    }
    if (options?.authName) {
      params.auth_name = options.authName;
    }
    return apiClient.get<OAuthStartResponse>(`/${provider}-auth-url`, {
      params: Object.keys(params).length ? params : undefined
    });
  },

  getAuthStatus: (state: string) =>
    apiClient.get<OAuthStatusResponse>(`/get-auth-status`, {
      params: { state }
    }),

  getReauthHistory: (options?: { authName?: string; limit?: number }) => {
    const params: Record<string, string | number> = {};
    if (options?.authName) {
      params.auth_name = options.authName;
    }
    if (typeof options?.limit === 'number' && Number.isFinite(options.limit)) {
      params.limit = Math.trunc(options.limit);
    }
    return apiClient.get<OAuthReauthHistoryResponse>('/oauth-reauth-history', {
      params: Object.keys(params).length ? params : undefined
    });
  },

  cancelAuth: (state: string) =>
    apiClient.delete<OAuthCancelResponse>('/oauth-session', {
      params: { state }
    }),

  submitCallback: (provider: OAuthProvider, redirectUrl: string) => {
    const callbackProvider = CALLBACK_PROVIDER_MAP[provider] ?? provider;
    return apiClient.post<OAuthCallbackResponse>('/oauth-callback', {
      provider: callbackProvider,
      redirect_url: redirectUrl
    });
  },

  /** iFlow cookie 认证 */
  iflowCookieAuth: (cookie: string) =>
    apiClient.post<IFlowCookieAuthResponse>('/iflow-auth-url', { cookie })
};
