import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useNotificationStore, useThemeStore } from '@/stores';
import { oauthApi, type OAuthProvider, type IFlowCookieAuthResponse } from '@/services/api/oauth';
import { authFilesApi } from '@/services/api/authFiles';
import type { AuthFileItem } from '@/types/authFile';
import { vertexApi, type VertexImportResponse } from '@/services/api/vertex';
import { copyToClipboard } from '@/utils/clipboard';
import styles from './OAuthPage.module.scss';
import iconCodex from '@/assets/icons/codex.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconAntigravity from '@/assets/icons/antigravity.svg';
import iconGemini from '@/assets/icons/gemini.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconIflow from '@/assets/icons/iflow.svg';
import iconVertex from '@/assets/icons/vertex.svg';

type OAuthFlowStep = 'generate_link' | 'wait_callback' | 'submit_callback' | 'exchange_token' | 'saved';

interface OAuthSuccessResult {
  provider: OAuthProvider;
  authFile?: string;
  account?: string;
  note?: string;
  proxyUrl?: string;
}

interface ProviderState {
  url?: string;
  state?: string;
  status?: 'idle' | 'starting' | 'waiting' | 'success' | 'cancelled' | 'error';
  error?: string;
  polling?: boolean;
  projectId?: string;
  projectIdError?: string;
  accountNote?: string;
  proxyUrl?: string;
  proxyUrlError?: string;
  expiresAtMs?: number;
  expiresInSeconds?: number;
  callbackUrl?: string;
  callbackSubmitting?: boolean;
  callbackStatus?: 'success' | 'error';
  callbackError?: string;
  authFilesBeforeStart?: string[];
  successResult?: OAuthSuccessResult;
}

interface IFlowCookieState {
  cookie: string;
  loading: boolean;
  result?: IFlowCookieAuthResponse;
  error?: string;
  errorType?: 'error' | 'warning';
}

interface VertexImportResult {
  projectId?: string;
  email?: string;
  location?: string;
  authFile?: string;
}

interface VertexImportState {
  file?: File;
  fileName: string;
  location: string;
  loading: boolean;
  error?: string;
  result?: VertexImportResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return typeof error === 'string' ? error : '';
}

function getErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

const PROVIDERS: {
  id: OAuthProvider;
  titleKey: string;
  hintKey: string;
  urlLabelKey: string;
  icon: string | { light: string; dark: string };
}[] = [
  {
    id: 'codex',
    titleKey: 'auth_login.codex_oauth_title',
    hintKey: 'auth_login.codex_oauth_hint',
    urlLabelKey: 'auth_login.codex_oauth_url_label',
    icon: iconCodex,
  },
  {
    id: 'anthropic',
    titleKey: 'auth_login.anthropic_oauth_title',
    hintKey: 'auth_login.anthropic_oauth_hint',
    urlLabelKey: 'auth_login.anthropic_oauth_url_label',
    icon: iconClaude,
  },
  {
    id: 'antigravity',
    titleKey: 'auth_login.antigravity_oauth_title',
    hintKey: 'auth_login.antigravity_oauth_hint',
    urlLabelKey: 'auth_login.antigravity_oauth_url_label',
    icon: iconAntigravity,
  },
  {
    id: 'gemini-cli',
    titleKey: 'auth_login.gemini_cli_oauth_title',
    hintKey: 'auth_login.gemini_cli_oauth_hint',
    urlLabelKey: 'auth_login.gemini_cli_oauth_url_label',
    icon: iconGemini,
  },
  {
    id: 'kimi',
    titleKey: 'auth_login.kimi_oauth_title',
    hintKey: 'auth_login.kimi_oauth_hint',
    urlLabelKey: 'auth_login.kimi_oauth_url_label',
    icon: { light: iconKimiLight, dark: iconKimiDark },
  },
  {
    id: 'qwen',
    titleKey: 'auth_login.qwen_oauth_title',
    hintKey: 'auth_login.qwen_oauth_hint',
    urlLabelKey: 'auth_login.qwen_oauth_url_label',
    icon: iconQwen,
  },
  {
    id: 'iflow',
    titleKey: 'auth_login.iflow_oauth_title',
    hintKey: 'auth_login.iflow_oauth_hint',
    urlLabelKey: 'auth_login.iflow_oauth_url_label',
    icon: iconIflow,
  },
];

const CALLBACK_SUPPORTED: OAuthProvider[] = [
  'codex',
  'anthropic',
  'antigravity',
  'gemini-cli',
  'iflow',
];
const getProviderI18nPrefix = (provider: OAuthProvider) => provider.replace('-', '_');
const getAuthKey = (provider: OAuthProvider, suffix: string) =>
  `auth_login.${getProviderI18nPrefix(provider)}_${suffix}`;

const getIcon = (icon: string | { light: string; dark: string }, theme: 'light' | 'dark') => {
  return typeof icon === 'string' ? icon : icon[theme];
};

const FINGERPRINT_PRESETS: Record<
  OAuthProvider,
  { profile: string; tls: string; headers: string }
> = {
  codex: {
    profile: 'codex_proxy_compatible_v1',
    tls: 'codex_proxy_compatible_v1',
    headers: 'Codex Desktop managed headers',
  },
  anthropic: {
    profile: 'claude_reqwest_rustls_compatible_v1',
    tls: 'claude_reqwest_rustls_compatible_v1',
    headers: 'Claude Code managed headers',
  },
  'gemini-cli': {
    profile: 'gemini_cli_native_v1',
    tls: 'gemini_cli_native_v1',
    headers: 'Gemini CLI native request identity',
  },
  antigravity: {
    profile: 'antigravity_oauth_proxy_bound_v1',
    tls: 'provider-default',
    headers: 'Provider OAuth defaults with account proxy isolation',
  },
  iflow: {
    profile: 'iflow_oauth_proxy_bound_v1',
    tls: 'provider-default',
    headers: 'Provider OAuth defaults with account proxy isolation',
  },
  kimi: {
    profile: 'kimi_device_flow_proxy_bound_v1',
    tls: 'provider-default',
    headers: 'Device-flow defaults with account proxy isolation',
  },
  qwen: {
    profile: 'qwen_device_flow_proxy_bound_v1',
    tls: 'provider-default',
    headers: 'Device-flow defaults with account proxy isolation',
  },
};

const validateProxyUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'direct' || trimmed.toLowerCase() === 'none')
    return undefined;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || !parsed.host) {
      return 'Unsupported proxy URL. Use http://, https://, socks5://, socks5h://, direct, or leave it empty.';
    }
    return undefined;
  } catch {
    return 'Invalid proxy URL. Use http://, https://, socks5://, socks5h://, direct, or leave it empty.';
  }
};

const formatDuration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const OAUTH_FLOW_STEPS: OAuthFlowStep[] = [
  'generate_link',
  'wait_callback',
  'submit_callback',
  'exchange_token',
  'saved',
];

const PROVIDER_MATCHERS: Record<OAuthProvider, string[]> = {
  codex: ['codex', 'openai'],
  anthropic: ['anthropic', 'claude'],
  antigravity: ['antigravity'],
  'gemini-cli': ['gemini-cli', 'gemini_cli', 'gemini'],
  iflow: ['iflow'],
  kimi: ['kimi'],
  qwen: ['qwen'],
};

const normalizeComparable = (value: string) => value.trim().toLowerCase().replace(/[_\s]/g, '-');

const readStringField = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
};

const getAuthFileModifiedMs = (entry: AuthFileItem) => {
  const record = entry as Record<string, unknown>;
  const raw = record.modified ?? record.modtime ?? record.updated_at ?? record.created_at;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const matchesAuthFileProvider = (entry: AuthFileItem, provider: OAuthProvider) => {
  const record = entry as Record<string, unknown>;
  const haystack = [
    entry.provider,
    entry.type,
    readStringField(record, ['account_type', 'oauth_provider']),
    entry.name,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalizeComparable);
  const needles = PROVIDER_MATCHERS[provider].map(normalizeComparable);
  return needles.some((needle) => haystack.some((value) => value.includes(needle)));
};

const getAuthFileAccount = (entry?: AuthFileItem) => {
  if (!entry) return undefined;
  const record = entry as Record<string, unknown>;
  return readStringField(record, [
    'email',
    'account',
    'account_email',
    'user_email',
    'username',
    'login',
    'project_id',
    'chatgpt_account_id',
    'account_id',
  ]);
};

const getAuthFileNote = (entry?: AuthFileItem) =>
  entry ? readStringField(entry as Record<string, unknown>, ['note', 'label']) : undefined;

const getAuthFileProxyUrl = (entry?: AuthFileItem) =>
  entry ? readStringField(entry as Record<string, unknown>, ['proxy_url', 'proxyUrl']) : undefined;

const findSavedAuthFile = (
  provider: OAuthProvider,
  beforeNames: string[] | undefined,
  files: AuthFileItem[],
  current: ProviderState
) => {
  const before = new Set(beforeNames ?? []);
  const candidates = files
    .filter((entry) => matchesAuthFileProvider(entry, provider))
    .sort((left, right) => getAuthFileModifiedMs(right) - getAuthFileModifiedMs(left));
  const newCandidate = candidates.find((entry) => !before.has(entry.name));
  if (newCandidate) return newCandidate;

  const note = (current.accountNote || '').trim();
  const proxyUrl = (current.proxyUrl || '').trim();
  return (
    candidates.find((entry) => note && getAuthFileNote(entry) === note) ||
    candidates.find((entry) => proxyUrl && getAuthFileProxyUrl(entry) === proxyUrl) ||
    candidates[0]
  );
};

const getOAuthFlowStep = (state: ProviderState): OAuthFlowStep => {
  if (state.status === 'success') return 'saved';
  if (state.callbackStatus === 'success' && state.status === 'waiting') return 'exchange_token';
  if (state.callbackSubmitting) return 'submit_callback';
  if (state.status === 'waiting') return 'wait_callback';
  return 'generate_link';
};

export function OAuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const [states, setStates] = useState<Record<OAuthProvider, ProviderState>>(
    {} as Record<OAuthProvider, ProviderState>
  );
  const [activeProvider, setActiveProvider] = useState<OAuthProvider>('codex');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [iflowCookie, setIflowCookie] = useState<IFlowCookieState>({ cookie: '', loading: false });
  const [vertexState, setVertexState] = useState<VertexImportState>({
    fileName: '',
    location: '',
    loading: false,
  });
  const timers = useRef<Record<string, number>>({});
  const statesRef = useRef(states);
  const vertexFileInputRef = useRef<HTMLInputElement | null>(null);

  const clearTimers = useCallback(() => {
    Object.values(timers.current).forEach((timer) => window.clearInterval(timer));
    timers.current = {};
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  useEffect(() => {
    const hasActiveCountdown = Object.values(states).some(
      (state) => state.url && state.status === 'waiting' && state.expiresAtMs
    );
    if (!hasActiveCountdown) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [states]);

  useEffect(() => {
    statesRef.current = states;
  }, [states]);

  const activeProviderConfig =
    PROVIDERS.find((provider) => provider.id === activeProvider) ?? PROVIDERS[0];
  const activeState = states[activeProviderConfig.id] || {};
  const canSubmitActiveCallback =
    CALLBACK_SUPPORTED.includes(activeProviderConfig.id) &&
    Boolean(activeState.url) &&
    activeState.status !== 'cancelled';
  const activeFlowStep = getOAuthFlowStep(activeState);
  const activeFlowStepIndex = OAUTH_FLOW_STEPS.indexOf(activeFlowStep);

  const updateProviderState = (provider: OAuthProvider, next: Partial<ProviderState>) => {
    setStates((prev) => ({
      ...prev,
      [provider]: { ...(prev[provider] ?? {}), ...next },
    }));
  };

  const resolveOAuthSuccessResult = async (
    provider: OAuthProvider,
    current: ProviderState,
    response: Record<string, unknown>
  ): Promise<OAuthSuccessResult> => {
    const authFileFromStatus = readStringField(response, [
      'auth_file',
      'authFile',
      'target_auth_file',
      'targetAuthFile',
      'auth_name',
      'authName',
      'saved_path',
      'savedPath',
      'file',
      'name',
    ]);
    const accountFromStatus = readStringField(response, [
      'account',
      'email',
      'account_email',
      'user_email',
      'username',
      'project_id',
      'chatgpt_account_id',
      'account_id',
    ]);

    let matchedFile: AuthFileItem | undefined;
    try {
      const filesResponse = await authFilesApi.list();
      matchedFile = findSavedAuthFile(
        provider,
        current.authFilesBeforeStart,
        filesResponse.files || [],
        current
      );
    } catch {
      matchedFile = undefined;
    }

    return {
      provider,
      authFile: authFileFromStatus || matchedFile?.name,
      account: accountFromStatus || getAuthFileAccount(matchedFile),
      note: (current.accountNote || '').trim() || getAuthFileNote(matchedFile),
      proxyUrl: (current.proxyUrl || '').trim() || getAuthFileProxyUrl(matchedFile),
    };
  };

  const resetProviderForNextAccount = (provider: OAuthProvider) => {
    updateProviderState(provider, {
      url: undefined,
      state: undefined,
      status: 'idle',
      error: undefined,
      polling: false,
      accountNote: '',
      proxyUrl: '',
      proxyUrlError: undefined,
      callbackUrl: '',
      callbackSubmitting: false,
      callbackStatus: undefined,
      callbackError: undefined,
      expiresAtMs: undefined,
      expiresInSeconds: undefined,
      authFilesBeforeStart: undefined,
      successResult: undefined,
    });
  };

  const startPolling = (provider: OAuthProvider, state: string) => {
    if (timers.current[provider]) {
      clearInterval(timers.current[provider]);
    }
    const timer = window.setInterval(async () => {
      try {
        const res = await oauthApi.getAuthStatus(state);
        if (res.status === 'ok') {
          window.clearInterval(timer);
          delete timers.current[provider];
          const current = statesRef.current[provider] || {};
          const successResult = await resolveOAuthSuccessResult(
            provider,
            current,
            res as unknown as Record<string, unknown>
          );
          updateProviderState(provider, {
            status: 'success',
            polling: false,
            url: undefined,
            state: undefined,
            error: undefined,
            accountNote: '',
            proxyUrl: '',
            proxyUrlError: undefined,
            callbackUrl: '',
            callbackSubmitting: false,
            callbackStatus: undefined,
            callbackError: undefined,
            expiresAtMs: undefined,
            expiresInSeconds: undefined,
            successResult,
          });
          showNotification(t(getAuthKey(provider, 'oauth_status_success')), 'success');
        } else if (res.status === 'cancelled') {
          const cancelledMessage =
            res.error?.trim() ||
            t('auth_login.oauth_status_cancelled', {
              defaultValue: 'Authentication cancelled. Start again if needed.',
            });
          updateProviderState(provider, {
            status: 'cancelled',
            error: cancelledMessage,
            polling: false,
            url: undefined,
            state: undefined,
          });
          showNotification(cancelledMessage, 'info');
          window.clearInterval(timer);
          delete timers.current[provider];
        } else if (res.status === 'error') {
          updateProviderState(provider, { status: 'error', error: res.error, polling: false });
          showNotification(
            `${t(getAuthKey(provider, 'oauth_status_error'))} ${res.error || ''}`,
            'error'
          );
          window.clearInterval(timer);
          delete timers.current[provider];
        }
      } catch (err: unknown) {
        updateProviderState(provider, {
          status: 'error',
          error: getErrorMessage(err),
          polling: false,
        });
        window.clearInterval(timer);
        delete timers.current[provider];
      }
    }, 3000);
    timers.current[provider] = timer;
  };

  const startAuth = async (provider: OAuthProvider) => {
    const current = states[provider] || {};
    const geminiState = provider === 'gemini-cli' ? current : undefined;
    const rawProjectId = provider === 'gemini-cli' ? (geminiState?.projectId || '').trim() : '';
    const projectId = rawProjectId
      ? rawProjectId.toUpperCase() === 'ALL'
        ? 'ALL'
        : rawProjectId
      : undefined;
    const proxyUrl = (current.proxyUrl || '').trim();
    const proxyUrlError = validateProxyUrl(proxyUrl);
    if (proxyUrlError) {
      updateProviderState(provider, { proxyUrlError });
      showNotification(proxyUrlError, 'warning');
      return;
    }
    // 项目 ID 可选：留空自动选择第一个可用项目；输入 ALL 获取全部项目
    if (provider === 'gemini-cli') {
      updateProviderState(provider, { projectIdError: undefined });
    }
    updateProviderState(provider, {
      status: 'starting',
      polling: true,
      error: undefined,
      proxyUrlError: undefined,
      callbackStatus: undefined,
      callbackError: undefined,
      callbackUrl: '',
      expiresAtMs: undefined,
      expiresInSeconds: undefined,
      authFilesBeforeStart: undefined,
      successResult: undefined,
    });
    try {
      let authFilesBeforeStart: string[] | undefined;
      try {
        const filesResponse = await authFilesApi.list();
        authFilesBeforeStart = (filesResponse.files || []).map((file) => file.name);
        updateProviderState(provider, { authFilesBeforeStart });
      } catch {
        authFilesBeforeStart = undefined;
      }
      const res = await oauthApi.startAuth(provider, {
        ...(provider === 'gemini-cli' ? { projectId: projectId || undefined } : {}),
        note: (current.accountNote || '').trim() || undefined,
        proxyUrl: proxyUrl || undefined,
      });
      if (!res.url) {
        throw new Error(t('auth_login.oauth_start_missing_url'));
      }
      const expiresInSeconds = Number.isFinite(res.expires_in_seconds)
        ? Number(res.expires_in_seconds)
        : undefined;
      const parsedExpiresAt = res.expires_at ? Date.parse(res.expires_at) : NaN;
      const expiresAtMs = Number.isFinite(parsedExpiresAt)
        ? parsedExpiresAt
        : expiresInSeconds
          ? nowMs + expiresInSeconds * 1000
          : undefined;
      updateProviderState(provider, {
        url: res.url,
        state: res.state,
        status: 'waiting',
        polling: true,
        expiresAtMs,
        expiresInSeconds,
      });
      if (res.state) {
        startPolling(provider, res.state);
      }
    } catch (err: unknown) {
      const rawMessage = getErrorMessage(err);
      const message = rawMessage.includes('Invalid OAuth start response')
        ? t('auth_login.oauth_start_invalid_response')
        : rawMessage;
      updateProviderState(provider, { status: 'error', error: message, polling: false });
      showNotification(
        `${t(getAuthKey(provider, 'oauth_start_error'))}${message ? ` ${message}` : ''}`,
        'error'
      );
    }
  };

  const copyLink = async (url?: string) => {
    if (!url) return;
    const copied = await copyToClipboard(url);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  };

  const submitCallback = async (provider: OAuthProvider) => {
    const redirectUrl = (states[provider]?.callbackUrl || '').trim();
    if (!redirectUrl) {
      showNotification(t('auth_login.oauth_callback_required'), 'warning');
      return;
    }
    updateProviderState(provider, {
      callbackSubmitting: true,
      callbackStatus: undefined,
      callbackError: undefined,
    });
    try {
      await oauthApi.submitCallback(provider, redirectUrl);
      updateProviderState(provider, { callbackSubmitting: false, callbackStatus: 'success' });
      showNotification(t('auth_login.oauth_callback_success'), 'success');
    } catch (err: unknown) {
      const status = getErrorStatus(err);
      const message = getErrorMessage(err);
      const errorMessage =
        status === 404
          ? t('auth_login.oauth_callback_upgrade_hint', {
              defaultValue: 'Please update CLI Proxy API or check the connection.',
            })
          : message || undefined;
      updateProviderState(provider, {
        callbackSubmitting: false,
        callbackStatus: 'error',
        callbackError: errorMessage,
      });
      const notificationMessage = errorMessage
        ? `${t('auth_login.oauth_callback_error')} ${errorMessage}`
        : t('auth_login.oauth_callback_error');
      showNotification(notificationMessage, 'error');
    }
  };

  const submitIflowCookie = async () => {
    const cookie = iflowCookie.cookie.trim();
    if (!cookie) {
      showNotification(t('auth_login.iflow_cookie_required'), 'warning');
      return;
    }
    setIflowCookie((prev) => ({
      ...prev,
      loading: true,
      error: undefined,
      errorType: undefined,
      result: undefined,
    }));
    try {
      const res = await oauthApi.iflowCookieAuth(cookie);
      if (res.status === 'ok') {
        setIflowCookie((prev) => ({ ...prev, loading: false, result: res }));
        showNotification(t('auth_login.iflow_cookie_status_success'), 'success');
      } else {
        setIflowCookie((prev) => ({
          ...prev,
          loading: false,
          error: res.error,
          errorType: 'error',
        }));
        showNotification(
          `${t('auth_login.iflow_cookie_status_error')} ${res.error || ''}`,
          'error'
        );
      }
    } catch (err: unknown) {
      if (getErrorStatus(err) === 409) {
        const message = t('auth_login.iflow_cookie_config_duplicate');
        setIflowCookie((prev) => ({
          ...prev,
          loading: false,
          error: message,
          errorType: 'warning',
        }));
        showNotification(message, 'warning');
        return;
      }
      const message = getErrorMessage(err);
      setIflowCookie((prev) => ({ ...prev, loading: false, error: message, errorType: 'error' }));
      showNotification(
        `${t('auth_login.iflow_cookie_start_error')}${message ? ` ${message}` : ''}`,
        'error'
      );
    }
  };

  const handleVertexFilePick = () => {
    vertexFileInputRef.current?.click();
  };

  const handleVertexFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      showNotification(t('vertex_import.file_required'), 'warning');
      event.target.value = '';
      return;
    }
    setVertexState((prev) => ({
      ...prev,
      file,
      fileName: file.name,
      error: undefined,
      result: undefined,
    }));
    event.target.value = '';
  };

  const handleVertexImport = async () => {
    if (!vertexState.file) {
      const message = t('vertex_import.file_required');
      setVertexState((prev) => ({ ...prev, error: message }));
      showNotification(message, 'warning');
      return;
    }
    const location = vertexState.location.trim();
    setVertexState((prev) => ({ ...prev, loading: true, error: undefined, result: undefined }));
    try {
      const res: VertexImportResponse = await vertexApi.importCredential(
        vertexState.file,
        location || undefined
      );
      const result: VertexImportResult = {
        projectId: res.project_id,
        email: res.email,
        location: res.location,
        authFile: res['auth-file'] ?? res.auth_file,
      };
      setVertexState((prev) => ({ ...prev, loading: false, result }));
      showNotification(t('vertex_import.success'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      setVertexState((prev) => ({
        ...prev,
        loading: false,
        error: message || t('notification.upload_failed'),
      }));
      const notification = message
        ? `${t('notification.upload_failed')}: ${message}`
        : t('notification.upload_failed');
      showNotification(notification, 'error');
    }
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('nav.oauth', { defaultValue: 'OAuth' })}</h1>

      <div className={styles.content}>
        <div className={styles.providerChooser} data-testid="oauth-provider-chooser">
          <div className={styles.providerChooserHeader}>
            <div>
              <div className={styles.sectionTitle}>
                {t('auth_login.add_account_title', { defaultValue: 'Add OAuth account' })}
              </div>
              <div className={styles.cardHint}>
                {t('auth_login.add_account_hint', {
                  defaultValue:
                    'Choose a provider, bind the account note and proxy, then finish OAuth in the same flow.',
                })}
              </div>
            </div>
          </div>
          <div
            className={styles.providerTabs}
            role="tablist"
            aria-label={t('nav.oauth', { defaultValue: 'OAuth' })}
          >
            {PROVIDERS.map((provider) => {
              const state = states[provider.id] || {};
              const selected = provider.id === activeProviderConfig.id;
              return (
                <button
                  key={provider.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`${styles.providerTab} ${selected ? styles.providerTabActive : ''}`.trim()}
                  onClick={() => setActiveProvider(provider.id)}
                  data-testid={`oauth-provider-tab-${provider.id}`}
                >
                  <img
                    src={getIcon(provider.icon, resolvedTheme)}
                    alt=""
                    className={styles.providerTabIcon}
                  />
                  <span className={styles.providerTabLabel}>{t(provider.titleKey)}</span>
                  {state.status && state.status !== 'idle' && (
                    <span
                      className={`${styles.providerTabStatus} ${styles[`providerStatus${state.status}`] || ''}`.trim()}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <Card
          title={
            <span className={styles.cardTitle}>
              <img
                src={getIcon(activeProviderConfig.icon, resolvedTheme)}
                alt=""
                className={styles.cardTitleIcon}
              />
              {t(activeProviderConfig.titleKey)}
            </span>
          }
          extra={
            <Button
              onClick={() => startAuth(activeProviderConfig.id)}
              loading={activeState.polling}
            >
              {t('auth_login.start_add_account', { defaultValue: 'Start Login' })}
            </Button>
          }
        >
          <div
            className={styles.cardContent}
            data-testid={`oauth-active-provider-${activeProviderConfig.id}`}
          >
            <div className={styles.cardHint}>{t(activeProviderConfig.hintKey)}</div>
            <div className={styles.accountSetupGrid}>
              <Input
                label={t('auth_login.account_note_label')}
                value={activeState.accountNote || ''}
                disabled={Boolean(activeState.polling)}
                onChange={(e) =>
                  updateProviderState(activeProviderConfig.id, { accountNote: e.target.value })
                }
                placeholder={t('auth_login.account_note_placeholder')}
              />
              <Input
                label={t('auth_login.account_proxy_label')}
                hint={t('auth_login.account_proxy_hint')}
                value={activeState.proxyUrl || ''}
                error={activeState.proxyUrlError}
                disabled={Boolean(activeState.polling)}
                onChange={(e) =>
                  updateProviderState(activeProviderConfig.id, {
                    proxyUrl: e.target.value,
                    proxyUrlError: undefined,
                  })
                }
                placeholder={t('auth_login.account_proxy_placeholder')}
              />
            </div>
            <div
              className={styles.fingerprintBox}
              data-testid={`oauth-fingerprint-${activeProviderConfig.id}`}
            >
              <div className={styles.connectionLabel}>{t('auth_login.fingerprint_title')}</div>
              <div className={styles.keyValueList}>
                <div className={styles.keyValueItem}>
                  <span className={styles.keyValueKey}>{t('auth_login.fingerprint_profile')}</span>
                  <span className={styles.keyValueValue}>
                    {FINGERPRINT_PRESETS[activeProviderConfig.id].profile}
                  </span>
                </div>
                <div className={styles.keyValueItem}>
                  <span className={styles.keyValueKey}>{t('auth_login.fingerprint_tls')}</span>
                  <span className={styles.keyValueValue}>
                    {FINGERPRINT_PRESETS[activeProviderConfig.id].tls}
                  </span>
                </div>
                <div className={styles.keyValueItem}>
                  <span className={styles.keyValueKey}>{t('auth_login.fingerprint_headers')}</span>
                  <span className={styles.keyValueValue}>
                    {FINGERPRINT_PRESETS[activeProviderConfig.id].headers}
                  </span>
                </div>
              </div>
            </div>
            {activeProviderConfig.id === 'gemini-cli' && (
              <div className={styles.geminiProjectField}>
                <Input
                  label={t('auth_login.gemini_cli_project_id_label')}
                  hint={t('auth_login.gemini_cli_project_id_hint')}
                  value={activeState.projectId || ''}
                  error={activeState.projectIdError}
                  disabled={Boolean(activeState.polling)}
                  onChange={(e) =>
                    updateProviderState(activeProviderConfig.id, {
                      projectId: e.target.value,
                      projectIdError: undefined,
                    })
                  }
                  placeholder={t('auth_login.gemini_cli_project_id_placeholder')}
                />
              </div>
            )}
            {activeState.status && activeState.status !== 'idle' && (
              <div
                className={styles.flowSteps}
                data-testid={`oauth-flow-steps-${activeProviderConfig.id}`}
              >
                {OAUTH_FLOW_STEPS.map((step, index) => {
                  const isDone = activeState.status === 'success' || index < activeFlowStepIndex;
                  const isActive = index === activeFlowStepIndex && activeState.status !== 'success';
                  return (
                    <div
                      key={step}
                      className={`${styles.flowStep} ${isDone ? styles.flowStepDone : ''} ${isActive ? styles.flowStepActive : ''}`.trim()}
                      data-testid={`oauth-flow-step-${step}`}
                    >
                      <span className={styles.flowStepDot} />
                      <span className={styles.flowStepLabel}>
                        {t(`auth_login.oauth_flow_${step}`)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {activeState.url && (
              <div className={styles.authUrlBox}>
                <div className={styles.authUrlLabel}>{t(activeProviderConfig.urlLabelKey)}</div>
                {activeState.expiresAtMs && (
                  <div
                    className={styles.countdownBadge}
                    data-testid={`oauth-countdown-${activeProviderConfig.id}`}
                  >
                    {t('auth_login.oauth_countdown', {
                      time: formatDuration((activeState.expiresAtMs - nowMs) / 1000),
                    })}
                  </div>
                )}
                <div className={styles.authUrlValue}>{activeState.url}</div>
                <div className={styles.cardHintSecondary}>
                  {t('auth_login.oauth_link_ready_hint')}
                </div>
                <div className={styles.authUrlActions}>
                  <Button variant="secondary" size="sm" onClick={() => copyLink(activeState.url!)}>
                    {t(getAuthKey(activeProviderConfig.id, 'copy_link'))}
                  </Button>
                </div>
              </div>
            )}
            {canSubmitActiveCallback && (
              <div className={styles.callbackSection}>
                <Input
                  label={t('auth_login.oauth_callback_label')}
                  hint={t('auth_login.oauth_callback_hint')}
                  value={activeState.callbackUrl || ''}
                  onChange={(e) =>
                    updateProviderState(activeProviderConfig.id, {
                      callbackUrl: e.target.value,
                      callbackStatus: undefined,
                      callbackError: undefined,
                    })
                  }
                  placeholder={t('auth_login.oauth_callback_placeholder')}
                />
                <div className={styles.callbackActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => submitCallback(activeProviderConfig.id)}
                    loading={activeState.callbackSubmitting}
                  >
                    {t('auth_login.oauth_callback_button')}
                  </Button>
                </div>
                {activeState.callbackStatus === 'success' && activeState.status === 'waiting' && (
                  <div className="status-badge success">
                    {t('auth_login.oauth_callback_status_success')}
                  </div>
                )}
                {activeState.callbackStatus === 'error' && (
                  <div className="status-badge error">
                    {t('auth_login.oauth_callback_status_error')} {activeState.callbackError || ''}
                  </div>
                )}
              </div>
            )}
            {activeState.status && activeState.status !== 'idle' && (
              <div className="status-badge">
                {activeState.status === 'success'
                  ? t(getAuthKey(activeProviderConfig.id, 'oauth_status_success'))
                  : activeState.status === 'cancelled'
                    ? activeState.error ||
                      t('auth_login.oauth_status_cancelled', {
                        defaultValue: 'Authentication cancelled. Start again if needed.',
                      })
                    : activeState.status === 'error'
                      ? `${t(getAuthKey(activeProviderConfig.id, 'oauth_status_error'))} ${activeState.error || ''}`
                      : activeState.status === 'starting'
                        ? t('auth_login.oauth_status_starting')
                        : t(getAuthKey(activeProviderConfig.id, 'oauth_status_waiting'))}
              </div>
            )}
            {activeState.status === 'success' && activeState.successResult && (
              <div
                className={styles.successResultBox}
                data-testid={`oauth-success-result-${activeProviderConfig.id}`}
              >
                <div className={styles.connectionLabel}>
                  {t('auth_login.oauth_saved_result_title')}
                </div>
                <div className={styles.keyValueList}>
                  <div className={styles.keyValueItem}>
                    <span className={styles.keyValueKey}>
                      {t('auth_login.oauth_saved_auth_file')}
                    </span>
                    <span className={styles.keyValueValue}>
                      {activeState.successResult.authFile ||
                        t('auth_login.oauth_saved_auth_file_unknown')}
                    </span>
                  </div>
                  <div className={styles.keyValueItem}>
                    <span className={styles.keyValueKey}>
                      {t('auth_login.oauth_saved_account')}
                    </span>
                    <span className={styles.keyValueValue}>
                      {activeState.successResult.account ||
                        t('auth_login.oauth_saved_account_unknown')}
                    </span>
                  </div>
                  {activeState.successResult.note && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>
                        {t('auth_login.oauth_saved_note')}
                      </span>
                      <span className={styles.keyValueValue}>{activeState.successResult.note}</span>
                    </div>
                  )}
                  {activeState.successResult.proxyUrl && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>
                        {t('auth_login.oauth_saved_proxy')}
                      </span>
                      <span className={styles.keyValueValue}>
                        {activeState.successResult.proxyUrl}
                      </span>
                    </div>
                  )}
                </div>
                <div className={styles.successActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      navigate('/auth-files', {
                        state: { highlightAuthFile: activeState.successResult?.authFile },
                      })
                    }
                  >
                    {t('auth_login.oauth_view_auth_file')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => resetProviderForNextAccount(activeProviderConfig.id)}
                  >
                    {t('auth_login.oauth_add_another')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Vertex JSON 登录 */}
        <Card
          title={
            <span className={styles.cardTitle}>
              <img src={iconVertex} alt="" className={styles.cardTitleIcon} />
              {t('vertex_import.title')}
            </span>
          }
          extra={
            <Button onClick={handleVertexImport} loading={vertexState.loading}>
              {t('vertex_import.import_button')}
            </Button>
          }
        >
          <div className={styles.cardContent}>
            <div className={styles.cardHint}>{t('vertex_import.description')}</div>
            <Input
              label={t('vertex_import.location_label')}
              hint={t('vertex_import.location_hint')}
              value={vertexState.location}
              onChange={(e) =>
                setVertexState((prev) => ({
                  ...prev,
                  location: e.target.value,
                }))
              }
              placeholder={t('vertex_import.location_placeholder')}
            />
            <div className={styles.formItem}>
              <label className={styles.formItemLabel}>{t('vertex_import.file_label')}</label>
              <div className={styles.filePicker}>
                <Button variant="secondary" size="sm" onClick={handleVertexFilePick}>
                  {t('vertex_import.choose_file')}
                </Button>
                <div
                  className={`${styles.fileName} ${
                    vertexState.fileName ? '' : styles.fileNamePlaceholder
                  }`.trim()}
                >
                  {vertexState.fileName || t('vertex_import.file_placeholder')}
                </div>
              </div>
              <div className={styles.cardHintSecondary}>{t('vertex_import.file_hint')}</div>
              <input
                ref={vertexFileInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleVertexFileChange}
              />
            </div>
            {vertexState.error && <div className="status-badge error">{vertexState.error}</div>}
            {vertexState.result && (
              <div className={styles.connectionBox}>
                <div className={styles.connectionLabel}>{t('vertex_import.result_title')}</div>
                <div className={styles.keyValueList}>
                  {vertexState.result.projectId && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>
                        {t('vertex_import.result_project')}
                      </span>
                      <span className={styles.keyValueValue}>{vertexState.result.projectId}</span>
                    </div>
                  )}
                  {vertexState.result.email && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>{t('vertex_import.result_email')}</span>
                      <span className={styles.keyValueValue}>{vertexState.result.email}</span>
                    </div>
                  )}
                  {vertexState.result.location && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>
                        {t('vertex_import.result_location')}
                      </span>
                      <span className={styles.keyValueValue}>{vertexState.result.location}</span>
                    </div>
                  )}
                  {vertexState.result.authFile && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>{t('vertex_import.result_file')}</span>
                      <span className={styles.keyValueValue}>{vertexState.result.authFile}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* iFlow Cookie 登录 */}
        <Card
          title={
            <span className={styles.cardTitle}>
              <img src={iconIflow} alt="" className={styles.cardTitleIcon} />
              {t('auth_login.iflow_cookie_title')}
            </span>
          }
          extra={
            <Button onClick={submitIflowCookie} loading={iflowCookie.loading}>
              {t('auth_login.iflow_cookie_button')}
            </Button>
          }
        >
          <div className={styles.cardContent}>
            <div className={styles.cardHint}>{t('auth_login.iflow_cookie_hint')}</div>
            <div className={styles.cardHintSecondary}>{t('auth_login.iflow_cookie_key_hint')}</div>
            <div className={styles.formItem}>
              <label className={styles.formItemLabel}>{t('auth_login.iflow_cookie_label')}</label>
              <Input
                value={iflowCookie.cookie}
                onChange={(e) => setIflowCookie((prev) => ({ ...prev, cookie: e.target.value }))}
                placeholder={t('auth_login.iflow_cookie_placeholder')}
              />
            </div>
            {iflowCookie.error && (
              <div
                className={`status-badge ${iflowCookie.errorType === 'warning' ? 'warning' : 'error'}`}
              >
                {iflowCookie.errorType === 'warning'
                  ? t('auth_login.iflow_cookie_status_duplicate')
                  : t('auth_login.iflow_cookie_status_error')}{' '}
                {iflowCookie.error}
              </div>
            )}
            {iflowCookie.result && iflowCookie.result.status === 'ok' && (
              <div className={styles.connectionBox}>
                <div className={styles.connectionLabel}>
                  {t('auth_login.iflow_cookie_result_title')}
                </div>
                <div className={styles.keyValueList}>
                  {iflowCookie.result.email && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>
                        {t('auth_login.iflow_cookie_result_email')}
                      </span>
                      <span className={styles.keyValueValue}>{iflowCookie.result.email}</span>
                    </div>
                  )}
                  {iflowCookie.result.expired && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>
                        {t('auth_login.iflow_cookie_result_expired')}
                      </span>
                      <span className={styles.keyValueValue}>{iflowCookie.result.expired}</span>
                    </div>
                  )}
                  {iflowCookie.result.saved_path && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>
                        {t('auth_login.iflow_cookie_result_path')}
                      </span>
                      <span className={styles.keyValueValue}>{iflowCookie.result.saved_path}</span>
                    </div>
                  )}
                  {iflowCookie.result.type && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>
                        {t('auth_login.iflow_cookie_result_type')}
                      </span>
                      <span className={styles.keyValueValue}>{iflowCookie.result.type}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
