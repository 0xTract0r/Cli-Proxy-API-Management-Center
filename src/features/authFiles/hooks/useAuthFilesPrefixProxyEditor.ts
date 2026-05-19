import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import type {
  AuthFileAccountSettings,
  AuthFileClientVersionObservation,
  AuthFileAccountSettingsPatchRequest,
  AuthFileManagedHeaderState,
  AuthFileItem,
} from '@/types/authFile';
import { useNotificationStore } from '@/stores';

type AuthFileHeaders = Record<string, string>;
type AuthFileHeadersErrorKey =
  | 'auth_files.headers_invalid_json'
  | 'auth_files.headers_invalid_object'
  | 'auth_files.headers_invalid_value';

export type PrefixProxyEditorField =
  | 'proxyUrl'
  | 'note'
  | 'disabled'
  | 'refreshEnabled'
  | 'extraHeadersText'
  | 'transportProfileText'
  | 'tlsProfileText';

export type PrefixProxyEditorFieldValue = string | boolean;

export type PrefixProxyEditorState = {
  fileName: string;
  provider: string;
  fileInfoText: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  proxyUrl: string;
  note: string;
  disabled: boolean;
  refreshEnabled: boolean;
  managedHeaders: AuthFileHeaders;
  managedHeaderState: AuthFileManagedHeaderState | null;
  clientVersionObservations: AuthFileClientVersionObservation[];
  runtimeProfileText: string;
  runtimeIdentityText: string;
  warnings: string[];
  extraHeadersText: string;
  extraHeadersTouched: boolean;
  extraHeadersError: string | null;
  transportProfileText: string;
  transportProfileTouched: boolean;
  transportProfileError: string | null;
  tlsProfileText: string;
  tlsProfileTouched: boolean;
  tlsProfileError: string | null;
  originalSerializedRequest: string;
};

export type UseAuthFilesPrefixProxyEditorOptions = {
  disableControls: boolean;
  loadFiles: () => Promise<void>;
  loadKeyStats: () => Promise<void>;
};

export type UseAuthFilesPrefixProxyEditorResult = {
  prefixProxyEditor: PrefixProxyEditorState | null;
  prefixProxyUpdatedText: string;
  prefixProxyDirty: boolean;
  openPrefixProxyEditor: (file: AuthFileItem) => Promise<void>;
  closePrefixProxyEditor: () => void;
  handlePrefixProxyChange: (
    field: PrefixProxyEditorField,
    value: PrefixProxyEditorFieldValue
  ) => void;
  handlePrefixProxySave: () => Promise<void>;
};

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const validateHeadersValue = (value: unknown): AuthFileHeadersErrorKey | null => {
  if (!isRecordObject(value)) {
    return 'auth_files.headers_invalid_object';
  }
  return Object.values(value).every((item) => typeof item === 'string')
    ? null
    : 'auth_files.headers_invalid_value';
};

const parseHeadersText = (
  text: string
): { value: AuthFileHeaders | null; errorKey: AuthFileHeadersErrorKey | null } => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: {}, errorKey: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { value: null, errorKey: 'auth_files.headers_invalid_json' };
  }

  const errorKey = validateHeadersValue(parsed);
  if (errorKey) {
    return { value: null, errorKey };
  }

  return { value: parsed as AuthFileHeaders, errorKey: null };
};

const stringifyProfile = (value: string | Record<string, unknown> | null | undefined): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

const resolveAuthFileProvider = (
  file: AuthFileItem,
  settings: Partial<AuthFileAccountSettings> | null | undefined
): string => {
  const runtimeProvider = settings?.runtime_profile?.provider;
  const rawProvider =
    (typeof runtimeProvider === 'string' && runtimeProvider) ||
    (typeof file.provider === 'string' && file.provider) ||
    (typeof file.type === 'string' && file.type) ||
    '';
  return rawProvider.trim().toLowerCase();
};

const parseProfileText = (
  text: string
): { value: string | Record<string, unknown> | null; error: string | null } => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: null, error: null };
  }
  if (!trimmed.startsWith('{')) {
    return { value: trimmed, error: null };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecordObject(parsed)) {
      return { value: null, error: 'Profile must be a JSON object or plain string preset.' };
    }
    return { value: parsed, error: null };
  } catch {
    return { value: null, error: 'Profile JSON is invalid.' };
  }
};

const normalizeSettings = (
  fileName: string,
  settings: Partial<AuthFileAccountSettings> | null | undefined
): AuthFileAccountSettingsPatchRequest => ({
  name: fileName,
  proxy_url: (settings?.proxy_url || '').trim() || null,
  note: (settings?.note || '').trim() || null,
  disabled: settings?.disabled === true,
  refresh_enabled: settings?.refresh_enabled !== false,
  extra_headers: settings?.extra_headers || {},
  transport_profile: settings?.transport_profile || null,
  tls_profile: settings?.tls_profile || null,
});

const buildPatchRequest = (
  editor: PrefixProxyEditorState
): {
  request: AuthFileAccountSettingsPatchRequest | null;
  error: string | null;
} => {
  const parsedHeaders = parseHeadersText(editor.extraHeadersText);
  if (parsedHeaders.errorKey) {
    return { request: null, error: parsedHeaders.errorKey };
  }
  const parsedTransportProfile = parseProfileText(editor.transportProfileText);
  if (parsedTransportProfile.error) {
    return { request: null, error: parsedTransportProfile.error };
  }
  const parsedTLSProfile = parseProfileText(editor.tlsProfileText);
  if (parsedTLSProfile.error) {
    return { request: null, error: parsedTLSProfile.error };
  }

  return {
    request: {
      name: editor.fileName,
      proxy_url: editor.proxyUrl.trim() || null,
      note: editor.note.trim() || null,
      disabled: editor.disabled,
      refresh_enabled: editor.refreshEnabled,
      extra_headers: parsedHeaders.value || {},
      transport_profile: parsedTransportProfile.value,
      tls_profile: parsedTLSProfile.value,
    },
    error: null,
  };
};

export function useAuthFilesPrefixProxyEditor(
  options: UseAuthFilesPrefixProxyEditorOptions
): UseAuthFilesPrefixProxyEditorResult {
  const { disableControls, loadFiles, loadKeyStats } = options;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [prefixProxyEditor, setPrefixProxyEditor] = useState<PrefixProxyEditorState | null>(null);

  const prefixProxyUpdatedText = (() => {
    if (!prefixProxyEditor) return '';
    const { request, error } = buildPatchRequest(prefixProxyEditor);
    if (!request || error) return '';
    return JSON.stringify(request, null, 2);
  })();

  const prefixProxyDirty =
    Boolean(prefixProxyEditor) &&
    prefixProxyUpdatedText !== '' &&
    prefixProxyUpdatedText !== prefixProxyEditor?.originalSerializedRequest;

  const closePrefixProxyEditor = () => {
    setPrefixProxyEditor(null);
  };

  const hydrateEditor = (
    name: string,
    file: AuthFileItem,
    settings: Partial<AuthFileAccountSettings> | null | undefined
  ) => {
    const normalizedRequest = normalizeSettings(name, settings);
    setPrefixProxyEditor({
      fileName: name,
      provider: resolveAuthFileProvider(file, settings),
      fileInfoText: JSON.stringify(file, null, 2),
      loading: false,
      saving: false,
      error: null,
      proxyUrl: settings?.proxy_url || '',
      note: settings?.note || '',
      disabled: settings?.disabled === true,
      refreshEnabled: settings?.refresh_enabled !== false,
      managedHeaders: settings?.managed_headers || {},
      managedHeaderState: settings?.managed_header_state || null,
      clientVersionObservations: Array.isArray(settings?.client_version_observations)
        ? settings.client_version_observations
        : [],
      runtimeProfileText: stringifyProfile(settings?.runtime_profile),
      runtimeIdentityText: stringifyProfile(settings?.runtime_identity),
      warnings: Array.isArray(settings?.warnings) ? settings.warnings : [],
      extraHeadersText: JSON.stringify(settings?.extra_headers || {}, null, 2),
      extraHeadersTouched: false,
      extraHeadersError: null,
      transportProfileText: stringifyProfile(settings?.transport_profile),
      transportProfileTouched: false,
      transportProfileError: null,
      tlsProfileText: stringifyProfile(settings?.tls_profile),
      tlsProfileTouched: false,
      tlsProfileError: null,
      originalSerializedRequest: JSON.stringify(normalizedRequest, null, 2),
    });
  };

  const openPrefixProxyEditor = async (file: AuthFileItem) => {
    const name = file.name;

    if (disableControls) return;
    if (prefixProxyEditor?.fileName === name) {
      setPrefixProxyEditor(null);
      return;
    }

    const inlineSettings = file.account_settings || file.accountSettings || null;
    setPrefixProxyEditor({
      fileName: name,
      provider: resolveAuthFileProvider(file, inlineSettings),
      fileInfoText: JSON.stringify(file, null, 2),
      loading: true,
      saving: false,
      error: null,
      proxyUrl: inlineSettings?.proxy_url || '',
      note: inlineSettings?.note || '',
      disabled: inlineSettings?.disabled === true,
      refreshEnabled: inlineSettings?.refresh_enabled !== false,
      managedHeaders: inlineSettings?.managed_headers || {},
      managedHeaderState: inlineSettings?.managed_header_state || null,
      clientVersionObservations: Array.isArray(inlineSettings?.client_version_observations)
        ? inlineSettings.client_version_observations
        : [],
      runtimeProfileText: stringifyProfile(inlineSettings?.runtime_profile),
      runtimeIdentityText: stringifyProfile(inlineSettings?.runtime_identity),
      warnings: Array.isArray(inlineSettings?.warnings) ? inlineSettings.warnings : [],
      extraHeadersText: JSON.stringify(inlineSettings?.extra_headers || {}, null, 2),
      extraHeadersTouched: false,
      extraHeadersError: null,
      transportProfileText: stringifyProfile(inlineSettings?.transport_profile),
      transportProfileTouched: false,
      transportProfileError: null,
      tlsProfileText: stringifyProfile(inlineSettings?.tls_profile),
      tlsProfileTouched: false,
      tlsProfileError: null,
      originalSerializedRequest: '',
    });

    try {
      const settings = await authFilesApi.getAccountSettings(name);
      hydrateEditor(name, file, settings);
    } catch (err: unknown) {
      if (inlineSettings) {
        hydrateEditor(name, file, inlineSettings);
        return;
      }
      const errorMessage = err instanceof Error ? err.message : t('notification.download_failed');
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== name) return prev;
        return { ...prev, loading: false, error: errorMessage };
      });
      showNotification(`${t('notification.download_failed')}: ${errorMessage}`, 'error');
    }
  };

  const handlePrefixProxyChange = (
    field: PrefixProxyEditorField,
    value: PrefixProxyEditorFieldValue
  ) => {
    setPrefixProxyEditor((prev) => {
      if (!prev) return prev;
      if (field === 'proxyUrl') return { ...prev, proxyUrl: String(value) };
      if (field === 'note') return { ...prev, note: String(value) };
      if (field === 'disabled') return { ...prev, disabled: Boolean(value) };
      if (field === 'refreshEnabled') return { ...prev, refreshEnabled: Boolean(value) };
      if (field === 'extraHeadersText') {
        const extraHeadersText = String(value);
        const { errorKey } = parseHeadersText(extraHeadersText);
        return {
          ...prev,
          extraHeadersText,
          extraHeadersTouched: true,
          extraHeadersError: errorKey ? t(errorKey) : null,
        };
      }
      if (field === 'transportProfileText') {
        const transportProfileText = String(value);
        return {
          ...prev,
          transportProfileText,
          transportProfileTouched: true,
          transportProfileError: parseProfileText(transportProfileText).error,
        };
      }
      const tlsProfileText = String(value);
      return {
        ...prev,
        tlsProfileText,
        tlsProfileTouched: true,
        tlsProfileError: parseProfileText(tlsProfileText).error,
      };
    });
  };

  const handlePrefixProxySave = async () => {
    if (!prefixProxyEditor || !prefixProxyDirty) return;

    const { request, error } = buildPatchRequest(prefixProxyEditor);
    if (!request) {
      const errorMessage = error?.startsWith('auth_files.') ? t(error) : error || 'Invalid format';
      showNotification(errorMessage, 'error');
      return;
    }

    setPrefixProxyEditor((prev) => {
      if (!prev) return prev;
      return { ...prev, saving: true };
    });

    try {
      await authFilesApi.updateAccountSettings(request);
      showNotification(
        t('auth_files.prefix_proxy_saved_success', {
          name: request.name,
          defaultValue: `Saved account settings for ${request.name}`,
        }),
        'success'
      );
      await loadFiles();
      await loadKeyStats();
      setPrefixProxyEditor(null);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.upload_failed')}: ${errorMessage}`, 'error');
      setPrefixProxyEditor((prev) => {
        if (!prev) return prev;
        return { ...prev, saving: false };
      });
    }
  };

  return {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  };
}
