/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';

export type OAuthProvider =
  | 'codex'
  | 'anthropic'
  | 'antigravity'
  | 'gemini-cli'
  | 'kimi'
  | 'xai';

export interface OAuthStartResponse {
  url?: string;
  auth_url?: string;
  authUrl?: string;
  authorization_url?: string;
  state?: string;
  expires_in_seconds?: number;
  expires_at?: string;
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
  auth_file?: string;
  authFile?: string;
  target_auth_file?: string;
  targetAuthFile?: string;
  account?: string;
  email?: string;
  account_email?: string;
  user_email?: string;
  username?: string;
  project_id?: string;
  chatgpt_account_id?: string;
  account_id?: string;
}

export interface OAuthCancelResponse {
  status: 'ok' | 'error';
  cancelled?: boolean;
  error?: string;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

const WEBUI_SUPPORTED: OAuthProvider[] = [
  'codex',
  'anthropic',
  'antigravity',
  'gemini-cli',
  'xai',
];
const CALLBACK_PROVIDER_MAP: Partial<Record<OAuthProvider, string>> = {
  'gemini-cli': 'gemini',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

export const isOAuthCancelSuccessful = (response: OAuthCancelResponse) =>
  response.status === 'ok' && response.cancelled !== false;

const normalizeOAuthStartResponse = (response: OAuthStartResponse): OAuthStartResponse => {
  if (!isRecord(response)) {
    throw new Error('Invalid OAuth start response. Check that the API address points to CPA backend, not the web UI server.');
  }
  const url =
    optionalString(response.url) ||
    optionalString(response.auth_url) ||
    optionalString(response.authUrl) ||
    optionalString(response.authorization_url);
  return { ...response, url };
};

export const oauthApi = {
  startAuth: (
    provider: OAuthProvider,
    options?: { projectId?: string; authName?: string; note?: string; proxyUrl?: string }
  ) => {
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
    if (options?.note) {
      params.note = options.note;
    }
    if (options?.proxyUrl) {
      params.proxy_url = options.proxyUrl;
    }
    return apiClient
      .get<OAuthStartResponse>(`/${provider}-auth-url`, {
        params: Object.keys(params).length ? params : undefined,
      })
      .then(normalizeOAuthStartResponse);
  },

  getAuthStatus: (state: string) =>
    apiClient.get<OAuthStatusResponse>(`/get-auth-status`, {
      params: { state },
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
      params: Object.keys(params).length ? params : undefined,
    });
  },

  cancelAuth: (state: string) =>
    apiClient.delete<OAuthCancelResponse>('/oauth-session', {
      params: { state },
    }),

  submitCallback: (provider: OAuthProvider, redirectUrl: string) => {
    const callbackProvider = CALLBACK_PROVIDER_MAP[provider] ?? provider;
    return apiClient.post<OAuthCallbackResponse>('/oauth-callback', {
      provider: callbackProvider,
      redirect_url: redirectUrl,
    });
  },
};
