import {
  useCallback,
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { animate } from 'motion/mini';
import type { AnimationPlaybackControlsWithThen } from 'motion-dom';
import { useInterval } from '@/hooks/useInterval';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { authFilesApi } from '@/services/api';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { IconFilterAll } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/EmptyState';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { copyToClipboard } from '@/utils/clipboard';
import {
  MAX_CARD_PAGE_SIZE,
  MIN_CARD_PAGE_SIZE,
  QUOTA_PROVIDER_TYPES,
  clampCardPageSize,
  getAuthFileIcon,
  getTypeColor,
  getTypeLabel,
  hasAuthFileStatusWarning,
  hasAuthFileStatusMessage,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  parsePriorityValue,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { AuthFileCard } from '@/features/authFiles/components/AuthFileCard';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { AuthFilesPrefixProxyEditorModal } from '@/features/authFiles/components/AuthFilesPrefixProxyEditorModal';
import { OAuthExcludedCard } from '@/features/authFiles/components/OAuthExcludedCard';
import { OAuthModelAliasCard } from '@/features/authFiles/components/OAuthModelAliasCard';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import {
  resolveAuthFileOAuthProvider,
  useAuthFilesReauth,
} from '@/features/authFiles/hooks/useAuthFilesReauth';
import { useAuthFilesStats } from '@/features/authFiles/hooks/useAuthFilesStats';
import { useAuthFilesStatusBarCache } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import {
  isAuthFilesSortMode,
  readAuthFilesUiState,
  readPersistedAuthFilesCompactMode,
  writeAuthFilesUiState,
  writePersistedAuthFilesCompactMode,
  type AuthFilesSortMode,
} from '@/features/authFiles/uiState';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import styles from './AuthFilesPage.module.scss';

const easePower3Out = (progress: number) => 1 - (1 - progress) ** 4;
const easePower2In = (progress: number) => progress ** 3;
const BATCH_BAR_BASE_TRANSFORM = 'translateX(-50%)';
const BATCH_BAR_HIDDEN_TRANSFORM = 'translateX(-50%) translateY(56px)';
const DEFAULT_REGULAR_PAGE_SIZE = 9;
const DEFAULT_COMPACT_PAGE_SIZE = 12;
const WARNING_AUTO_REFRESH_INTERVAL_MS = 240_000;
const WARNING_AUTO_REFRESH_REENTRY_COOLDOWN_MS = 15_000;
const DEFAULT_TEST_MESSAGE = 'Reply with OK only.';
const DEFAULT_TEST_MAX_TOKENS = 16;
const TEST_MESSAGE_CUSTOM_MODEL_VALUE = '__custom_model__';

type TestMessageResultState =
  | {
      status: 'success';
      title: string;
      outputPreview: string;
      meta: string[];
      raw: string;
    }
  | {
      status: 'error';
      title: string;
      message: string;
      raw: string;
    };

const escapeWildcardSearchSegment = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildWildcardSearch = (value: string): RegExp | null => {
  if (!value.includes('*')) return null;
  const pattern = value.split('*').map(escapeWildcardSearchSegment).join('.*');
  return new RegExp(pattern, 'i');
};

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const payload = err as Record<string, unknown>;
    if (typeof payload.message === 'string') return payload.message;
    if (typeof payload.error === 'string') return payload.error;
  }
  return '';
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const parseJsonIfPossible = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
};

const toPrettyJson = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const extractFirstString = (value: unknown, keys: Set<string>, depth = 0): string => {
  if (depth > 5 || value === null || value === undefined) return '';
  const parsed = parseJsonIfPossible(value);
  if (typeof parsed === 'string') return '';
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const found = extractFirstString(entry, keys, depth + 1);
      if (found) return found;
    }
    return '';
  }
  const record = asRecord(parsed);
  if (!record) return '';

  for (const [key, entry] of Object.entries(record)) {
    if (keys.has(key.toLowerCase()) && typeof entry === 'string' && entry.trim()) {
      return entry.trim();
    }
  }
  for (const entry of Object.values(record)) {
    const found = extractFirstString(entry, keys, depth + 1);
    if (found) return found;
  }
  return '';
};

const extractFirstNumber = (value: unknown, keys: Set<string>, depth = 0): number | null => {
  if (depth > 5 || value === null || value === undefined) return null;
  const parsed = parseJsonIfPossible(value);
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const found = extractFirstNumber(entry, keys, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const record = asRecord(parsed);
  if (!record) return null;

  for (const [key, entry] of Object.entries(record)) {
    if (!keys.has(key.toLowerCase())) continue;
    const numeric = typeof entry === 'number' ? entry : Number(entry);
    if (Number.isFinite(numeric)) return numeric;
  }
  for (const entry of Object.values(record)) {
    const found = extractFirstNumber(entry, keys, depth + 1);
    if (found !== null) return found;
  }
  return null;
};

const normalizeModelId = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  const record = asRecord(value);
  if (!record) return '';
  const raw = record.id ?? record.model ?? record.name ?? record.display_name;
  return typeof raw === 'string' ? raw.trim() : '';
};

const resolveModelOptions = (
  file: AuthFileItem,
  accountModels: Record<string, { id: string }[]> = {}
): string[] => {
  const rawFileModels = file.models ?? file['models'];
  const candidates = [
    ...(Array.isArray(rawFileModels) ? rawFileModels.map(normalizeModelId) : []),
    ...(accountModels[file.name] ?? []).map(normalizeModelId),
  ];
  const seen = new Set<string>();
  return candidates.reduce<string[]>((result, entry) => {
    const model = entry.trim();
    if (!model || seen.has(model)) return result;
    seen.add(model);
    result.push(model);
    return result;
  }, []);
};

const getErrorPayload = (err: unknown): unknown => {
  const record = asRecord(err);
  return parseJsonIfPossible(record?.details ?? record?.data ?? getErrorMessage(err) ?? err);
};

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
};

export function AuthFilesPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;
  const navigate = useNavigate();

  const [filter, setFilter] = useState<'all' | string>('all');
  const [problemOnly, setProblemOnly] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSizeByMode, setPageSizeByMode] = useState({
    regular: DEFAULT_REGULAR_PAGE_SIZE,
    compact: DEFAULT_COMPACT_PAGE_SIZE,
  });
  const [pageSizeInput, setPageSizeInput] = useState('9');
  const [viewMode, setViewMode] = useState<'diagram' | 'list'>('list');
  const [sortMode, setSortMode] = useState<AuthFilesSortMode>('default');
  const [batchActionBarVisible, setBatchActionBarVisible] = useState(false);
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  const [reauthHistoryReloadKey, setReauthHistoryReloadKey] = useState(0);
  const [statusHistoryReloadKey, setStatusHistoryReloadKey] = useState(0);
  const [messageTesting, setMessageTesting] = useState<Record<string, boolean>>({});
  const [testMessageFile, setTestMessageFile] = useState<AuthFileItem | null>(null);
  const [testMessageModel, setTestMessageModel] = useState('');
  const [testMessageText, setTestMessageText] = useState(DEFAULT_TEST_MESSAGE);
  const [testMessageMaxTokens, setTestMessageMaxTokens] = useState(String(DEFAULT_TEST_MAX_TOKENS));
  const [testMessageResult, setTestMessageResult] = useState<TestMessageResultState | null>(null);
  const [testMessageRawExpanded, setTestMessageRawExpanded] = useState(false);
  const [testMessageAccountModels, setTestMessageAccountModels] = useState<
    Record<string, { id: string }[]>
  >({});
  const [testMessageModelsLoading, setTestMessageModelsLoading] = useState(false);
  const [testMessageModelsError, setTestMessageModelsError] = useState('');
  const floatingBatchActionsRef = useRef<HTMLDivElement>(null);
  const batchActionAnimationRef = useRef<AnimationPlaybackControlsWithThen | null>(null);
  const testMessageModelsCacheRef = useRef<Map<string, { id: string }[]>>(new Map());
  const testMessageModelsRequestRef = useRef(0);
  const previousSelectionCountRef = useRef(0);
  const selectionCountRef = useRef(0);
  const warningAutoRefreshAtRef = useRef<Record<string, number>>({});
  const bumpReauthHistoryReloadKey = useCallback(() => {
    setReauthHistoryReloadKey((value) => value + 1);
  }, []);
  const bumpStatusHistoryReloadKey = useCallback(() => {
    setStatusHistoryReloadKey((value) => value + 1);
  }, []);

  const { keyStats, usageDetails, loadKeyStats, refreshKeyStats } = useAuthFilesStats();
  const {
    files,
    selectedFiles,
    selectionCount,
    loading,
    error,
    uploading,
    deleting,
    deletingAll,
    statusUpdating,
    statusRefreshing,
    batchStatusUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDeleteAll,
    handleDownload,
    handleStatusToggle,
    handleStatusRefresh,
    toggleSelect,
    selectAllVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
  } = useAuthFilesData({
    refreshKeyStats,
    onStatusHistoryChanged: bumpStatusHistoryReloadKey,
  });
  const {
    reauthStates,
    startReauth,
    copyReauthLink,
    cancelReauth,
    updateReauthCallbackUrl,
    submitReauthCallback,
  } = useAuthFilesReauth({
    loadFiles,
    refreshKeyStats,
    onHistoryChanged: bumpReauthHistoryReloadKey,
  });

  const statusBarCache = useAuthFilesStatusBarCache(files, usageDetails);

  const {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    allProviderModels,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  } = useAuthFilesOauth({ viewMode, files });

  const {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
  } = useAuthFilesModels();

  const {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  } = useAuthFilesPrefixProxyEditor({
    disableControls: connectionStatus !== 'connected',
    loadFiles,
    loadKeyStats: refreshKeyStats,
  });

  const disableControls = connectionStatus !== 'connected';
  const normalizedFilter = normalizeProviderKey(String(filter));
  const quotaFilterType: QuotaProviderType | null = QUOTA_PROVIDER_TYPES.has(
    normalizedFilter as QuotaProviderType
  )
    ? (normalizedFilter as QuotaProviderType)
    : null;
  const pageSize = compactMode ? pageSizeByMode.compact : pageSizeByMode.regular;

  useEffect(() => {
    const persistedCompactMode = readPersistedAuthFilesCompactMode();
    if (typeof persistedCompactMode === 'boolean') {
      setCompactMode(persistedCompactMode);
    }

    const persisted = readAuthFilesUiState();
    if (persisted) {
      if (typeof persisted.filter === 'string' && persisted.filter.trim()) {
        setFilter(persisted.filter);
      }
      if (typeof persisted.problemOnly === 'boolean') {
        setProblemOnly(persisted.problemOnly);
      }
      if (
        typeof persistedCompactMode !== 'boolean' &&
        typeof persisted.compactMode === 'boolean'
      ) {
        setCompactMode(persisted.compactMode);
      }
      if (typeof persisted.search === 'string') {
        setSearch(persisted.search);
      }
      if (typeof persisted.page === 'number' && Number.isFinite(persisted.page)) {
        setPage(Math.max(1, Math.round(persisted.page)));
      }
      const legacyPageSize =
        typeof persisted.pageSize === 'number' && Number.isFinite(persisted.pageSize)
          ? clampCardPageSize(persisted.pageSize)
          : null;
      const regularPageSize =
        typeof persisted.regularPageSize === 'number' && Number.isFinite(persisted.regularPageSize)
          ? clampCardPageSize(persisted.regularPageSize)
          : legacyPageSize ?? DEFAULT_REGULAR_PAGE_SIZE;
      const compactPageSize =
        typeof persisted.compactPageSize === 'number' && Number.isFinite(persisted.compactPageSize)
          ? clampCardPageSize(persisted.compactPageSize)
          : legacyPageSize ?? DEFAULT_COMPACT_PAGE_SIZE;
      setPageSizeByMode({
        regular: regularPageSize,
        compact: compactPageSize,
      });
      if (isAuthFilesSortMode(persisted.sortMode)) {
        setSortMode(persisted.sortMode);
      }
    }

    setUiStateHydrated(true);
  }, []);

  useEffect(() => {
    if (!uiStateHydrated) return;

    writeAuthFilesUiState({
      filter,
      problemOnly,
      compactMode,
      search,
      page,
      pageSize,
      regularPageSize: pageSizeByMode.regular,
      compactPageSize: pageSizeByMode.compact,
      sortMode,
    });
    writePersistedAuthFilesCompactMode(compactMode);
  }, [
    compactMode,
    filter,
    page,
    pageSize,
    pageSizeByMode,
    problemOnly,
    search,
    sortMode,
    uiStateHydrated,
  ]);

  useEffect(() => {
    setPageSizeInput(String(pageSize));
  }, [pageSize]);

  const setCurrentModePageSize = useCallback(
    (next: number) => {
      setPageSizeByMode((current) =>
        compactMode ? { ...current, compact: next } : { ...current, regular: next }
      );
    },
    [compactMode]
  );

  const commitPageSizeInput = (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const next = clampCardPageSize(value);
    setCurrentModePageSize(next);
    setPageSizeInput(String(next));
    setPage(1);
  };

  const handlePageSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.currentTarget.value;
    setPageSizeInput(rawValue);

    const trimmed = rawValue.trim();
    if (!trimmed) return;

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;

    const rounded = Math.round(parsed);
    if (rounded < MIN_CARD_PAGE_SIZE || rounded > MAX_CARD_PAGE_SIZE) return;

    setCurrentModePageSize(rounded);
    setPage(1);
  };

  const handleSortModeChange = useCallback(
    (value: string) => {
      if (!isAuthFilesSortMode(value) || value === sortMode) return;
      setSortMode(value);
      setPage(1);
      void loadFiles().catch(() => {});
    },
    [loadFiles, sortMode]
  );

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadFiles(), refreshKeyStats(), loadExcluded(), loadModelAlias()]);
  }, [loadFiles, refreshKeyStats, loadExcluded, loadModelAlias]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    if (!isCurrentLayer) return;
    loadFiles();
    void loadKeyStats().catch(() => {});
    loadExcluded();
    loadModelAlias();
  }, [isCurrentLayer, loadFiles, loadKeyStats, loadExcluded, loadModelAlias]);

  useInterval(
    () => {
      void refreshKeyStats().catch(() => {});
    },
    isCurrentLayer ? WARNING_AUTO_REFRESH_INTERVAL_MS : null
  );

  const warningFilesForAutoRefresh = useMemo(
    () =>
      files.filter((file) => {
        if (isRuntimeOnlyAuthFile(file) || file.disabled) return false;
        if (!resolveAuthFileOAuthProvider(file)) return false;
        if (!hasAuthFileStatusWarning(file)) return false;
        if (statusRefreshing[file.name] === true) return false;
        const reauthState = reauthStates[file.name];
        return reauthState?.status !== 'starting' && reauthState?.status !== 'polling';
      }),
    [files, reauthStates, statusRefreshing]
  );

  const refreshWarningFilesSilently = useCallback(
    (reason: 'interval' | 'layer' | 'visible' | 'focus' = 'interval') => {
      if (warningFilesForAutoRefresh.length === 0) return;

      const now = Date.now();
      const minimumElapsed =
        reason === 'interval'
          ? WARNING_AUTO_REFRESH_INTERVAL_MS
          : WARNING_AUTO_REFRESH_REENTRY_COOLDOWN_MS;

      const candidates = warningFilesForAutoRefresh.filter((file) => {
        const lastRefreshedAt = warningAutoRefreshAtRef.current[file.name] ?? 0;
        return now - lastRefreshedAt >= minimumElapsed;
      });

      if (candidates.length === 0) return;

      candidates.forEach((file) => {
        warningAutoRefreshAtRef.current[file.name] = now;
        void handleStatusRefresh(file, { silent: true, trigger: 'auto' });
      });
    },
    [handleStatusRefresh, warningFilesForAutoRefresh]
  );

  useEffect(() => {
    if (!isCurrentLayer || loading) return;
    refreshWarningFilesSilently('layer');
  }, [isCurrentLayer, loading, refreshWarningFilesSilently]);

  useEffect(() => {
    if (!isCurrentLayer) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      refreshWarningFilesSilently('visible');
    };

    const handleWindowFocus = () => {
      refreshWarningFilesSilently('focus');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [isCurrentLayer, refreshWarningFilesSilently]);

  useEffect(() => {
    // 仅在账号真正脱离 warning 候选集时清理 cooldown。
    // 不要因为“当前正在刷新中”就把 cooldown 删掉，否则会在 finally 后立刻再次触发 auto refresh。
    const retainedWarningNames = new Set(
      files
        .filter((file) => {
          if (isRuntimeOnlyAuthFile(file) || file.disabled) return false;
          if (!resolveAuthFileOAuthProvider(file)) return false;
          return hasAuthFileStatusWarning(file);
        })
        .map((file) => file.name)
    );

    Object.keys(warningAutoRefreshAtRef.current).forEach((name) => {
      if (!retainedWarningNames.has(name)) {
        delete warningAutoRefreshAtRef.current[name];
      }
    });
  }, [files]);

  useInterval(
    () => {
      refreshWarningFilesSilently('interval');
    },
    isCurrentLayer ? WARNING_AUTO_REFRESH_INTERVAL_MS : null
  );

  const existingTypes = useMemo(() => {
    const types = new Set<string>(['all']);
    files.forEach((file) => {
      if (file.type) {
        types.add(file.type);
      }
    });
    return Array.from(types);
  }, [files]);

  const filesMatchingProblemFilter = useMemo(
    () => (problemOnly ? files.filter(hasAuthFileStatusMessage) : files),
    [files, problemOnly]
  );

  const sortOptions = useMemo(
    () => [
      { value: 'default', label: t('auth_files.sort_default') },
      { value: 'az', label: t('auth_files.sort_az') },
      { value: 'priority', label: t('auth_files.sort_priority') },
    ],
    [t]
  );

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: filesMatchingProblemFilter.length };
    filesMatchingProblemFilter.forEach((file) => {
      if (!file.type) return;
      counts[file.type] = (counts[file.type] || 0) + 1;
    });
    return counts;
  }, [filesMatchingProblemFilter]);

  const normalizedSearch = search.trim();
  const wildcardSearch = useMemo(() => buildWildcardSearch(normalizedSearch), [normalizedSearch]);

  const filtered = useMemo(() => {
    const normalizedTerm = normalizedSearch.toLowerCase();

    return filesMatchingProblemFilter.filter((item) => {
      const matchType = filter === 'all' || item.type === filter;
      const matchSearch =
        !normalizedSearch ||
        [item.name, item.type, item.provider].some((value) => {
          const content = (value || '').toString();
          return wildcardSearch
            ? wildcardSearch.test(content)
            : content.toLowerCase().includes(normalizedTerm);
        });
      return matchType && matchSearch;
    });
  }, [filesMatchingProblemFilter, filter, normalizedSearch, wildcardSearch]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    if (sortMode === 'default') {
      copy.sort((a, b) => {
        const providerA = normalizeProviderKey(String(a.provider ?? a.type ?? 'unknown'));
        const providerB = normalizeProviderKey(String(b.provider ?? b.type ?? 'unknown'));
        const providerCompare = providerA.localeCompare(providerB);
        if (providerCompare !== 0) return providerCompare;
        return a.name.localeCompare(b.name);
      });
    } else if (sortMode === 'az') {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === 'priority') {
      copy.sort((a, b) => {
        const pa = parsePriorityValue(a.priority ?? a['priority']) ?? 0;
        const pb = parsePriorityValue(b.priority ?? b['priority']) ?? 0;
        return pb - pa; // 高优先级排前面
      });
    }
    return copy;
  }, [filtered, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);
  const selectablePageItems = useMemo(
    () => pageItems.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [pageItems]
  );
  const selectableFilteredItems = useMemo(
    () => sorted.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [sorted]
  );
  const selectedNames = useMemo(() => Array.from(selectedFiles), [selectedFiles]);
  const selectedHasStatusUpdating = useMemo(
    () => selectedNames.some((name) => statusUpdating[name] === true),
    [selectedNames, statusUpdating]
  );
  const testMessageModelOptions = useMemo(
    () =>
      testMessageFile
        ? resolveModelOptions(testMessageFile, testMessageAccountModels)
        : [],
    [testMessageAccountModels, testMessageFile]
  );
  const testMessageModelSelectOptions = useMemo(
    () => [
      ...testMessageModelOptions.map((model) => ({ value: model, label: model })),
      {
        value: TEST_MESSAGE_CUSTOM_MODEL_VALUE,
        label: t('auth_files.test_message_model_custom_option', {
          defaultValue: 'Enter model ID manually',
        }),
      },
    ],
    [t, testMessageModelOptions]
  );
  const testMessageModelFromList = testMessageModelOptions.includes(testMessageModel.trim());
  const testMessageSelectValue =
    testMessageModelFromList && testMessageModel.trim()
      ? testMessageModel.trim()
      : TEST_MESSAGE_CUSTOM_MODEL_VALUE;
  const testMessageManualModelVisible =
    testMessageModelOptions.length === 0 || testMessageSelectValue === TEST_MESSAGE_CUSTOM_MODEL_VALUE;
  const parsedTestMessageMaxTokens = useMemo(() => {
    const value = Number(testMessageMaxTokens);
    if (!Number.isFinite(value)) return null;
    const rounded = Math.round(value);
    return rounded > 0 && rounded <= 256 ? rounded : null;
  }, [testMessageMaxTokens]);
  const testMessageFileName = String(testMessageFile?.name ?? '').trim();
  const testMessageSubmitting = testMessageFileName
    ? messageTesting[testMessageFileName] === true
    : false;
  const testMessageSubmitDisabled =
    disableControls ||
    testMessageSubmitting ||
    !testMessageFileName ||
    !testMessageModel.trim() ||
    !testMessageText.trim() ||
    parsedTestMessageMaxTokens === null;
  const batchStatusButtonsDisabled =
    disableControls ||
    selectedNames.length === 0 ||
    batchStatusUpdating ||
    selectedHasStatusUpdating;

  const copyTextWithNotification = useCallback(
    async (text: string) => {
      const copied = await copyToClipboard(text);
      showNotification(
        copied
          ? t('notification.link_copied', { defaultValue: 'Copied to clipboard' })
          : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const openExcludedEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-excluded${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  const openModelAliasEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-model-alias${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  const describeTestMessageError = useCallback(
    (err: unknown) => {
      const payload = getErrorPayload(err);
      const fallback = getErrorMessage(err);
      const raw = toPrettyJson(payload) || fallback;
      const codeFromPayload = extractFirstString(
        payload,
        new Set(['code', 'type', 'error_code', 'error_type'])
      );
      const messageFromPayload = extractFirstString(
        payload,
        new Set(['message', 'detail', 'reason', 'error_description'])
      );
      const searchable = `${codeFromPayload} ${messageFromPayload} ${fallback} ${raw}`.toLowerCase();
      const resetSeconds = extractFirstNumber(
        payload,
        new Set([
          'reset_seconds',
          'reset_in_seconds',
          'resets_in_seconds',
          'retry_after',
          'retry_after_seconds',
          'cooldown_seconds',
        ])
      );
      const duration = resetSeconds !== null ? formatDuration(resetSeconds) : '';

      if (searchable.includes('model_cooldown')) {
        return {
          message: duration
            ? t('auth_files.test_message_error_model_cooldown_with_duration', {
                duration,
                defaultValue: `The selected model is cooling down. Try again in ${duration}.`,
              })
            : t('auth_files.test_message_error_model_cooldown', {
                defaultValue: 'The selected model is cooling down. Try again later or choose another model.',
              }),
          raw,
        };
      }

      if (
        searchable.includes('long_context_extra_usage_required') ||
        searchable.includes('extra usage is required for long context requests')
      ) {
        return {
          message: t('auth_files.test_message_error_claude_extra_usage', {
            defaultValue:
              'Claude Sonnet 1M requires Claude extra usage even on Max plans. Enable extra usage for this account or choose an Opus 1M model.',
          }),
          raw,
        };
      }

      if (searchable.includes('usage_limit_reached')) {
        return {
          message: duration
            ? t('auth_files.test_message_error_usage_limit_with_duration', {
                duration,
                defaultValue: `The account usage limit was reached. Try again in ${duration}.`,
              })
            : t('auth_files.test_message_error_usage_limit', {
                defaultValue: 'The account usage limit was reached. Try another account or wait for quota reset.',
              }),
          raw,
        };
      }

      return {
        message:
          messageFromPayload ||
          fallback ||
          t('auth_files.test_message_error_unknown', {
            defaultValue: 'The test request failed. See raw details below.',
          }),
        raw,
      };
    },
    [t]
  );

  const handleTestMessage = useCallback(
    (file: AuthFileItem) => {
      const accountName = String(file.name ?? '').trim();
      const cachedModels = testMessageModelsCacheRef.current.get(accountName);
      const initialAccountModels = cachedModels
        ? { ...testMessageAccountModels, [accountName]: cachedModels }
        : testMessageAccountModels;
      const models = resolveModelOptions(file, initialAccountModels);
      setTestMessageFile(file);
      setTestMessageModel(models[0] ?? '');
      setTestMessageText(DEFAULT_TEST_MESSAGE);
      setTestMessageMaxTokens(String(DEFAULT_TEST_MAX_TOKENS));
      setTestMessageResult(null);
      setTestMessageRawExpanded(false);
      setTestMessageModelsError('');

      if (!accountName) {
        setTestMessageModelsLoading(false);
        return;
      }
      if (cachedModels) {
        setTestMessageAccountModels((prev) => ({ ...prev, [accountName]: cachedModels }));
        setTestMessageModelsLoading(false);
        return;
      }

      const requestID = testMessageModelsRequestRef.current + 1;
      testMessageModelsRequestRef.current = requestID;
      setTestMessageModelsLoading(true);
      void authFilesApi
        .getModelsForAuthFile(accountName)
        .then((accountModels) => {
          if (testMessageModelsRequestRef.current !== requestID) return;
          testMessageModelsCacheRef.current.set(accountName, accountModels);
          const nextAccountModels = { [accountName]: accountModels };
          setTestMessageAccountModels((prev) => ({ ...prev, ...nextAccountModels }));
          const resolved = resolveModelOptions(file, nextAccountModels);
          if (resolved.length > 0) {
            setTestMessageModel((current) =>
              current.trim() && resolved.includes(current.trim()) ? current : resolved[0]
            );
          }
        })
        .catch((err: unknown) => {
          if (testMessageModelsRequestRef.current !== requestID) return;
          setTestMessageModelsError(getErrorMessage(err));
        })
        .finally(() => {
          if (testMessageModelsRequestRef.current === requestID) {
            setTestMessageModelsLoading(false);
          }
        });
    },
    [testMessageAccountModels]
  );

  const closeTestMessageModal = useCallback(() => {
    if (testMessageSubmitting) return;
    testMessageModelsRequestRef.current += 1;
    setTestMessageFile(null);
    setTestMessageResult(null);
    setTestMessageRawExpanded(false);
    setTestMessageModelsLoading(false);
    setTestMessageModelsError('');
  }, [testMessageSubmitting]);

  const submitTestMessage = useCallback(async () => {
    const name = testMessageFileName;
    const model = testMessageModel.trim();
    const message = testMessageText.trim();
    if (!name || !model || !message || parsedTestMessageMaxTokens === null) return;

    setMessageTesting((prev) => ({ ...prev, [name]: true }));
    setTestMessageResult(null);
    setTestMessageRawExpanded(false);
    try {
      const result = await authFilesApi.testMessage({
        name,
        model,
        message,
        max_tokens: parsedTestMessageMaxTokens,
      });
      const preview = String(result.output_preview ?? '').trim();
      const meta = [
        result.provider
          ? t('auth_files.test_message_result_provider', {
              provider: result.provider,
              defaultValue: `Provider: ${result.provider}`,
            })
          : '',
        result.model
          ? t('auth_files.test_message_result_model', {
              model: result.model,
              defaultValue: `Model: ${result.model}`,
            })
          : '',
        typeof result.latency_ms === 'number'
          ? t('auth_files.test_message_result_latency', {
              latency: Math.round(result.latency_ms),
              defaultValue: `Latency: ${Math.round(result.latency_ms)} ms`,
            })
          : '',
      ].filter(Boolean);
      setTestMessageResult({
        status: 'success',
        title: t('auth_files.test_message_success', { name }),
        outputPreview: preview,
        meta,
        raw: toPrettyJson(result),
      });
      await loadFiles();
    } catch (err) {
      const detail = describeTestMessageError(err);
      setTestMessageResult({
        status: 'error',
        title: t('auth_files.test_message_failed', { name }),
        message: detail.message,
        raw: detail.raw,
      });
    } finally {
      setMessageTesting((prev) => ({ ...prev, [name]: false }));
    }
  }, [
    describeTestMessageError,
    loadFiles,
    parsedTestMessageMaxTokens,
    t,
    testMessageFileName,
    testMessageModel,
    testMessageText,
  ]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    const actionsEl = floatingBatchActionsRef.current;
    if (!actionsEl) {
      document.documentElement.style.removeProperty('--auth-files-action-bar-height');
      return;
    }

    const updatePadding = () => {
      const height = actionsEl.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--auth-files-action-bar-height', `${height}px`);
    };

    updatePadding();
    window.addEventListener('resize', updatePadding);

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePadding);
    ro?.observe(actionsEl);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updatePadding);
      document.documentElement.style.removeProperty('--auth-files-action-bar-height');
    };
  }, [batchActionBarVisible, selectionCount]);

  useEffect(() => {
    selectionCountRef.current = selectionCount;
    if (selectionCount > 0) {
      setBatchActionBarVisible(true);
    }
  }, [selectionCount]);

  useLayoutEffect(() => {
    if (!batchActionBarVisible) return;
    const currentCount = selectionCount;
    const previousCount = previousSelectionCountRef.current;
    const actionsEl = floatingBatchActionsRef.current;
    if (!actionsEl) return;

    batchActionAnimationRef.current?.stop();
    batchActionAnimationRef.current = null;

    if (currentCount > 0 && previousCount === 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_HIDDEN_TRANSFORM, BATCH_BAR_BASE_TRANSFORM],
          opacity: [0, 1],
        },
        {
          duration: 0.28,
          ease: easePower3Out,
          onComplete: () => {
            actionsEl.style.transform = BATCH_BAR_BASE_TRANSFORM;
            actionsEl.style.opacity = '1';
          },
        }
      );
    } else if (currentCount === 0 && previousCount > 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_BASE_TRANSFORM, BATCH_BAR_HIDDEN_TRANSFORM],
          opacity: [1, 0],
        },
        {
          duration: 0.22,
          ease: easePower2In,
          onComplete: () => {
            if (selectionCountRef.current === 0) {
              setBatchActionBarVisible(false);
            }
          },
        }
      );
    }

    previousSelectionCountRef.current = currentCount;
  }, [batchActionBarVisible, selectionCount]);

  useEffect(
    () => () => {
      batchActionAnimationRef.current?.stop();
      batchActionAnimationRef.current = null;
    },
    []
  );

  const renderFilterTags = () => (
    <div className={styles.filterRail}>
      <div className={styles.filterTags}>
        {existingTypes.map((type) => {
          const isActive = filter === type;
          const iconSrc = getAuthFileIcon(type, resolvedTheme);
          const color =
            type === 'all'
              ? { bg: 'var(--bg-tertiary)', text: 'var(--text-primary)' }
              : getTypeColor(type, resolvedTheme);
          const buttonStyle = {
            '--filter-color': color.text,
            '--filter-surface': color.bg,
            '--filter-active-text': resolvedTheme === 'dark' ? '#111827' : '#ffffff',
          } as CSSProperties;

          return (
            <button
              key={type}
              className={`${styles.filterTag} ${isActive ? styles.filterTagActive : ''}`}
              style={buttonStyle}
              onClick={() => {
                setFilter(type);
                setPage(1);
              }}
            >
              <span className={styles.filterTagLabel}>
                {type === 'all' ? (
                  <span className={`${styles.filterTagIconWrap} ${styles.filterAllIconWrap}`}>
                    <IconFilterAll className={styles.filterAllIcon} size={16} />
                  </span>
                ) : (
                  <span className={styles.filterTagIconWrap}>
                    {iconSrc ? (
                      <img src={iconSrc} alt="" className={styles.filterTagIcon} />
                    ) : (
                      <span className={styles.filterTagIconFallback}>
                        {getTypeLabel(t, type).slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                )}
                <span className={styles.filterTagText}>{getTypeLabel(t, type)}</span>
              </span>
              <span className={styles.filterTagCount}>{typeCounts[type] ?? 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t('auth_files.title_section')}</span>
      {files.length > 0 && <span className={styles.countBadge}>{files.length}</span>}
    </div>
  );

  const deleteAllButtonLabel = problemOnly
    ? filter === 'all'
      ? t('auth_files.delete_problem_button')
      : t('auth_files.delete_problem_button_with_type', { type: getTypeLabel(t, filter) })
    : filter === 'all'
      ? t('auth_files.delete_all_button')
      : `${t('common.delete')} ${getTypeLabel(t, filter)}`;

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('auth_files.title')}</h1>
        <p className={styles.description}>{t('auth_files.description')}</p>
      </div>

      <Card
        title={titleNode}
        extra={
          <div className={styles.headerActions}>
            <Button variant="secondary" size="sm" onClick={handleHeaderRefresh} disabled={loading}>
              {t('common.refresh')}
            </Button>
            <Button
              size="sm"
              onClick={handleUploadClick}
              disabled={disableControls || uploading}
              loading={uploading}
            >
              {t('auth_files.upload_button')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() =>
                handleDeleteAll({
                  filter,
                  problemOnly,
                  onResetFilterToAll: () => setFilter('all'),
                  onResetProblemOnly: () => setProblemOnly(false),
                })
              }
              disabled={disableControls || loading || deletingAll}
              loading={deletingAll}
            >
              {deleteAllButtonLabel}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
        }
      >
        {error && <div className={styles.errorBox}>{error}</div>}

        <div className={styles.filterSection}>
          {renderFilterTags()}

          <div className={styles.filterContent}>
            <div className={styles.filterControlsPanel}>
              <div className={styles.filterControls}>
                <div className={styles.filterItem}>
                  <label>{t('auth_files.search_label')}</label>
                  <Input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder={t('auth_files.search_placeholder')}
                  />
                </div>
                <div className={styles.filterItem}>
                  <label>{t('auth_files.page_size_label')}</label>
                  <input
                    className={styles.pageSizeSelect}
                    type="number"
                    min={MIN_CARD_PAGE_SIZE}
                    max={MAX_CARD_PAGE_SIZE}
                    step={1}
                    value={pageSizeInput}
                    onChange={handlePageSizeChange}
                    onBlur={(e) => commitPageSizeInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className={styles.filterItem}>
                  <label>{t('auth_files.sort_label')}</label>
                  <Select
                    className={styles.sortSelect}
                    value={sortMode}
                    options={sortOptions}
                    onChange={handleSortModeChange}
                    ariaLabel={t('auth_files.sort_label')}
                    fullWidth
                  />
                </div>
                <div className={`${styles.filterItem} ${styles.filterToggleItem}`}>
                  <label>{t('auth_files.display_options_label')}</label>
                  <div className={styles.filterToggleGroup}>
                    <div className={styles.filterToggleCard}>
                      <ToggleSwitch
                        checked={problemOnly}
                        onChange={(value) => {
                          setProblemOnly(value);
                          setPage(1);
                        }}
                        ariaLabel={t('auth_files.problem_filter_only')}
                        label={
                          <span className={styles.filterToggleLabel}>
                            {t('auth_files.problem_filter_only')}
                          </span>
                        }
                      />
                    </div>
                    <div className={styles.filterToggleCard}>
                      <ToggleSwitch
                        checked={compactMode}
                        onChange={(value) => setCompactMode(value)}
                        ariaLabel={t('auth_files.compact_mode_label')}
                        label={
                          <span className={styles.filterToggleLabel}>
                            {t('auth_files.compact_mode_label')}
                          </span>
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {loading ? (
              <div className={styles.hint}>{t('common.loading')}</div>
            ) : pageItems.length === 0 ? (
              <EmptyState
                title={t('auth_files.search_empty_title')}
                description={t('auth_files.search_empty_desc')}
              />
            ) : (
              <>
                <div
                  className={`${styles.fileGrid} ${quotaFilterType ? styles.fileGridQuotaManaged : ''} ${compactMode ? styles.fileGridCompact : ''}`}
                >
                  {pageItems.map((file) => (
                    <AuthFileCard
                      key={file.name}
                      file={file}
                      compact={compactMode}
                      selected={selectedFiles.has(file.name)}
                      resolvedTheme={resolvedTheme}
                      disableControls={disableControls}
                      deleting={deleting}
                      statusUpdating={statusUpdating}
                      statusRefreshing={statusRefreshing}
                      messageTesting={messageTesting}
                      quotaFilterType={quotaFilterType}
                      reauthHistoryReloadKey={reauthHistoryReloadKey}
                      statusHistoryReloadKey={statusHistoryReloadKey}
                      keyStats={keyStats}
                      statusBarCache={statusBarCache}
                      onShowModels={showModels}
                      onDownload={handleDownload}
                      onOpenPrefixProxyEditor={openPrefixProxyEditor}
                      onDelete={handleDelete}
                      reauthState={reauthStates[file.name]}
                      onReauthenticate={startReauth}
                      onCopyReauthLink={copyReauthLink}
                      onCancelReauth={cancelReauth}
                      onChangeReauthCallbackUrl={updateReauthCallbackUrl}
                      onSubmitReauthCallback={submitReauthCallback}
                      onToggleStatus={handleStatusToggle}
                      onRefreshStatus={handleStatusRefresh}
                      onTestMessage={handleTestMessage}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </div>
              </>
            )}

            {!loading && sorted.length > pageSize && (
              <div className={styles.pagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1}
                >
                  {t('auth_files.pagination_prev')}
                </Button>
                <div className={styles.pageInfo}>
                  {t('auth_files.pagination_info', {
                    current: currentPage,
                    total: totalPages,
                    count: sorted.length,
                  })}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage >= totalPages}
                >
                  {t('auth_files.pagination_next')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      <OAuthExcludedCard
        disableControls={disableControls}
        excludedError={excludedError}
        excluded={excluded}
        onAdd={() => openExcludedEditor()}
        onEdit={openExcludedEditor}
        onDelete={deleteExcluded}
      />

      <OAuthModelAliasCard
        disableControls={disableControls}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onAdd={() => openModelAliasEditor()}
        onEditProvider={openModelAliasEditor}
        onDeleteProvider={deleteModelAlias}
        modelAliasError={modelAliasError}
        modelAlias={modelAlias}
        allProviderModels={allProviderModels}
        onUpdate={handleMappingUpdate}
        onDeleteLink={handleDeleteLink}
        onToggleFork={handleToggleFork}
        onRenameAlias={handleRenameAlias}
        onDeleteAlias={handleDeleteAlias}
      />

      <AuthFileModelsModal
        open={modelsModalOpen}
        fileName={modelsFileName}
        fileType={modelsFileType}
        loading={modelsLoading}
        error={modelsError}
        models={modelsList}
        excluded={excluded}
        onClose={closeModelsModal}
        onCopyText={copyTextWithNotification}
      />

      <Modal
        open={Boolean(testMessageFile)}
        onClose={closeTestMessageModal}
        closeDisabled={testMessageSubmitting}
        width={640}
        title={t('auth_files.test_message_modal_title', {
          name: testMessageFileName,
          defaultValue: `Test message - ${testMessageFileName}`,
        })}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={closeTestMessageModal}
              disabled={testMessageSubmitting}
            >
              {t('common.close')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void submitTestMessage()}
              loading={testMessageSubmitting}
              disabled={testMessageSubmitDisabled}
              data-testid="auth-file-test-message-submit"
            >
              {t('auth_files.test_message_submit', { defaultValue: 'Send test message' })}
            </Button>
          </>
        }
      >
        <div className={styles.testMessageModal}>
          <div className={styles.testMessageFileName}>
            <span>{t('auth_files.test_message_account_label', { defaultValue: 'Account file' })}</span>
            <code title={testMessageFileName}>{testMessageFileName || '-'}</code>
          </div>

          <div className={styles.formGroup}>
            <label id="auth-file-test-message-model-label">
              {t('auth_files.test_message_model_label', { defaultValue: 'Model' })}
            </label>
            <div data-testid="auth-file-test-message-model-select">
              <Select
                value={testMessageSelectValue}
                options={testMessageModelSelectOptions}
                onChange={(value) => {
                  setTestMessageModel(value === TEST_MESSAGE_CUSTOM_MODEL_VALUE ? '' : value);
                }}
                disabled={testMessageSubmitting || testMessageModelsLoading}
                ariaLabelledBy="auth-file-test-message-model-label"
              />
            </div>
            <div className="hint">
              {testMessageModelsLoading
                ? t('auth_files.test_message_model_loading', {
                    defaultValue: 'Loading this account model list...',
                  })
                : testMessageModelsError
                  ? t('auth_files.test_message_model_load_failed', {
                      defaultValue: 'Model list could not be loaded. Type a model id manually.',
                    })
                  : testMessageModelOptions.length > 0
                    ? t('auth_files.test_message_model_hint', {
                        defaultValue: 'Pick from this account model list or enter a model id manually.',
                      })
                    : t('auth_files.test_message_model_hint_empty', {
                        defaultValue: 'No model list was reported. Enter a model id manually.',
                      })}
            </div>
          </div>

          {testMessageManualModelVisible && (
            <Input
              label={t('auth_files.test_message_model_manual_label', {
                defaultValue: 'Manual model ID',
              })}
              value={testMessageModel}
              onChange={(event) => setTestMessageModel(event.currentTarget.value)}
              disabled={testMessageSubmitting}
              data-testid="auth-file-test-message-model"
              placeholder={t('auth_files.test_message_model_placeholder', {
                defaultValue: 'Enter a model id',
              })}
            />
          )}

          <Input
            label={t('auth_files.test_message_max_tokens_label', {
              defaultValue: 'Max tokens',
            })}
            type="number"
            min={1}
            max={256}
            step={1}
            value={testMessageMaxTokens}
            onChange={(event) => setTestMessageMaxTokens(event.currentTarget.value)}
            disabled={testMessageSubmitting}
            error={
              parsedTestMessageMaxTokens === null
                ? t('auth_files.test_message_max_tokens_error', {
                    defaultValue: 'Enter a positive integer from 1 to 256.',
                  })
                : undefined
            }
          />

          <div className={styles.formGroup}>
            <label htmlFor="auth-file-test-message-text">
              {t('auth_files.test_message_text_label', { defaultValue: 'Message' })}
            </label>
            <textarea
              id="auth-file-test-message-text"
              className={styles.textarea}
              rows={5}
              value={testMessageText}
              onChange={(event) => setTestMessageText(event.currentTarget.value)}
              disabled={testMessageSubmitting}
              placeholder={DEFAULT_TEST_MESSAGE}
            />
          </div>

          {testMessageResult && (
            <div
              className={`${styles.testMessageResult} ${
                testMessageResult.status === 'success'
                  ? styles.testMessageResultSuccess
                  : styles.testMessageResultError
              }`}
              data-testid={`auth-file-test-message-result-${testMessageResult.status}`}
            >
              <div className={styles.testMessageResultHeader}>
                <strong>{testMessageResult.title}</strong>
              </div>
              {testMessageResult.status === 'success' ? (
                <>
                  <div className={styles.testMessagePreview}>
                    {testMessageResult.outputPreview ||
                      t('auth_files.test_message_empty_preview', {
                        defaultValue: 'The request succeeded with no output preview.',
                      })}
                  </div>
                  {testMessageResult.meta.length > 0 && (
                    <div className={styles.testMessageMeta}>
                      {testMessageResult.meta.map((entry) => (
                        <span key={entry}>{entry}</span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className={styles.testMessagePreview}>{testMessageResult.message}</div>
              )}
              {testMessageResult.raw && (
                <div className={styles.testMessageRaw}>
                  <button
                    type="button"
                    className={styles.testMessageRawToggle}
                    onClick={() => setTestMessageRawExpanded((value) => !value)}
                  >
                    {testMessageRawExpanded
                      ? t('auth_files.test_message_raw_hide', { defaultValue: 'Hide raw details' })
                      : t('auth_files.test_message_raw_show', { defaultValue: 'Show raw details' })}
                  </button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void copyTextWithNotification(testMessageResult.raw)}
                  >
                    {t('common.copy', { defaultValue: 'Copy' })}
                  </Button>
                  {testMessageRawExpanded && (
                    <pre className={styles.testMessageRawContent}>
                      <code>{testMessageResult.raw}</code>
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <AuthFilesPrefixProxyEditorModal
        disableControls={disableControls}
        editor={prefixProxyEditor}
        updatedText={prefixProxyUpdatedText}
        dirty={prefixProxyDirty}
        onClose={closePrefixProxyEditor}
        onCopyText={copyTextWithNotification}
        onSave={handlePrefixProxySave}
        onChange={handlePrefixProxyChange}
      />

      {batchActionBarVisible && typeof document !== 'undefined'
        ? createPortal(
            <div className={styles.batchActionContainer} ref={floatingBatchActionsRef}>
              <div className={styles.batchActionBar}>
                <div className={styles.batchActionLeft}>
                  <span className={styles.batchSelectionText}>
                    {t('auth_files.batch_selected', { count: selectionCount })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_select_page')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(sorted)}
                    disabled={selectableFilteredItems.length === 0}
                  >
                    {t('auth_files.batch_select_filtered')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => invertVisibleSelection(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_invert_page')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={deselectAll}>
                    {t('auth_files.batch_deselect')}
                  </Button>
                </div>
                <div className={styles.batchActionRight}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void batchDownload(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('auth_files.batch_download')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, true)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_enable')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, false)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_disable')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => batchDelete(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
