import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { keymap } from '@codemirror/view';
import { JsonView } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type {
  PrefixProxyEditorField,
  PrefixProxyEditorFieldValue,
  PrefixProxyEditorState,
} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import type {
  AuthFileClientVersionObservation,
  AuthFileManagedHeaderHistoryEntry,
} from '@/types/authFile';
import { useThemeStore } from '@/stores';
import styles from '@/pages/AuthFilesPage.module.scss';

export type AuthFilesPrefixProxyEditorModalProps = {
  disableControls: boolean;
  editor: PrefixProxyEditorState | null;
  updatedText: string;
  dirty: boolean;
  onClose: () => void;
  onCopyText: (text: string) => void | Promise<void>;
  onSave: () => void;
  onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void;
};

type ManagedHeaderHistoryDiffRow = {
  field: string;
  previous?: unknown;
  next?: unknown;
};

const VERSIONED_CAPABILITIES_FIELD = 'versioned_capabilities';
const expandReadablePreview = (level: number) => level < 2;

function ReadOnlyCodeViewer({
  value,
  minRows = 4,
  testId,
  label,
  onCopyText,
}: {
  value: string;
  minRows?: number;
  testId?: string;
  label: string;
  onCopyText?: (text: string) => void | Promise<void>;
}) {
  const trimmed = value.trim();
  let parsed: unknown = null;
  let isJson = false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      parsed = JSON.parse(trimmed) as unknown;
      isJson = Boolean(parsed) && typeof parsed === 'object';
    } catch {
      isJson = false;
    }
  }

  return (
    <div
      className={styles.prefixProxyReadOnlyViewer}
      data-testid={testId}
      data-readonly-label={label}
      style={{ minHeight: `${Math.max(3, minRows) * 20 + 24}px` }}
      tabIndex={0}
    >
      <div className={styles.prefixProxyReadOnlyToolbar}>
        <span className={styles.prefixProxyReadOnlyBadge}>{label}</span>
        {isJson && (
          <span className={styles.prefixProxyReadOnlyBadge} data-testid="account-settings-json-viewer-badge">
            JSON tree
          </span>
        )}
        {onCopyText && value && (
          <button
            type="button"
            className={styles.prefixProxyReadOnlyCopyButton}
            data-testid="account-settings-json-viewer-copy"
            onClick={() => void onCopyText(value)}
          >
            Copy
          </button>
        )}
      </div>
      {isJson ? (
        <div className={styles.prefixProxyJsonTree} data-testid="account-settings-json-tree">
          <JsonView
            data={parsed as object}
            shouldExpandNode={expandReadablePreview}
            clickToExpandNode
            compactTopLevel
            style={{
              container: styles.jsonTreeContainer,
              childFieldsContainer: styles.jsonTreeChildFields,
              basicChildStyle: styles.jsonTreeChild,
              label: styles.jsonTreeLabel,
              clickableLabel: styles.jsonTreeClickableLabel,
              nullValue: styles.jsonTreeNull,
              undefinedValue: styles.jsonTreeNull,
              numberValue: styles.jsonTreeNumber,
              stringValue: styles.jsonTreeString,
              booleanValue: styles.jsonTreeBoolean,
              otherValue: styles.jsonTreeOther,
              punctuation: styles.jsonTreePunctuation,
              expandIcon: styles.jsonTreeExpandIcon,
              collapseIcon: styles.jsonTreeCollapseIcon,
              collapsedContent: styles.jsonTreeCollapsedContent,
              quotesForFieldNames: true,
              stringifyStringValues: true,
            }}
          />
        </div>
      ) : (
        <pre className={styles.prefixProxyReadOnlyCode}>
          <code>{value || '-'}</code>
        </pre>
      )}
    </div>
  );
}

function ManagedHeadersPanel({
  entries,
  t,
}: {
  entries: [string, string][];
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div className="form-group">
      <label>
        {t('auth_files.account_settings_managed_headers', {
          defaultValue: 'Core-managed request headers',
        })}
      </label>
      <div className={styles.managedHeaderPanel} data-testid="account-settings-managed-headers-panel">
        <div className={styles.managedHeaderPlainHeader}>
          <span>
            {t('auth_files.account_settings_managed_headers_runtime_title', {
              defaultValue: 'Actually applied by runtime',
            })}
          </span>
          <span className={styles.managedHeaderMeta}>
            {t('auth_files.account_settings_managed_headers_count', {
              count: entries.length,
              defaultValue: '{{count}} headers',
            })}
          </span>
        </div>
        {entries.length > 0 ? (
          <table className={styles.managedHeaderTable}>
            <thead>
              <tr>
                <th>
                  {t('auth_files.account_settings_managed_headers_table_name', {
                    defaultValue: 'Header',
                  })}
                </th>
                <th>
                  {t('auth_files.account_settings_managed_headers_table_value', {
                    defaultValue: 'Runtime value',
                  })}
                </th>
              </tr>
            </thead>
            <tbody>
            {entries.map(([name, value]) => (
              <tr data-testid="account-settings-managed-header-row" key={name}>
                <th scope="row" className={styles.managedHeaderKey}>
                  {name}
                </th>
                <td>
                  <code className={styles.managedHeaderValue} title={value}>
                    {value}
                  </code>
                </td>
              </tr>
            ))}
            </tbody>
          </table>
        ) : (
          <div className={styles.managedHeaderEmpty}>
            {t('auth_files.account_settings_managed_headers_empty', {
              defaultValue: 'No core-managed headers for this provider.',
            })}
          </div>
        )}
      </div>
      <div className="hint">
        {t('auth_files.account_settings_managed_headers_hint', {
          defaultValue:
            'Read-only. These are the headers core will merge into the runtime request. Use Extra headers only for user-owned additions.',
        })}
      </div>
    </div>
  );
}

function ClaudeHeaderStrategyPanel({
  t,
}: {
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const rows = [
    ['User-Agent', 'auth_files.account_settings_claude_header_strategy_client_version'],
    [
      'X-Stainless-Package-Version',
      'auth_files.account_settings_claude_header_strategy_client_version',
    ],
    [
      'X-Stainless-Runtime-Version',
      'auth_files.account_settings_claude_header_strategy_client_runtime',
    ],
    ['X-Stainless-Os / X-Stainless-Arch', 'auth_files.account_settings_claude_header_strategy_platform'],
    ['X-App', 'auth_files.account_settings_claude_header_strategy_stable'],
  ] as const;

  return (
    <div className="form-group">
      <label>
        {t('auth_files.account_settings_claude_header_strategy', {
          defaultValue: 'Claude request header strategy',
        })}
      </label>
      <div className={styles.managedHeaderPanel} data-testid="account-settings-claude-header-strategy-panel">
        <div className={styles.managedHeaderPlainHeader}>
          <span>
            {t('auth_files.account_settings_claude_header_strategy_runtime_title', {
              defaultValue: 'Resolved per incoming Claude CLI request',
            })}
          </span>
          <span className={styles.managedHeaderMeta}>Claude only</span>
        </div>
        <table className={styles.managedHeaderTable}>
          <thead>
            <tr>
              <th>
                {t('auth_files.account_settings_managed_headers_table_name', {
                  defaultValue: 'Header',
                })}
              </th>
              <th>
                {t('auth_files.account_settings_claude_header_strategy_source', {
                  defaultValue: 'Source',
                })}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, sourceKey]) => (
              <tr data-testid="account-settings-claude-header-strategy-row" key={name}>
                <th scope="row" className={styles.managedHeaderKey}>
                  {name}
                </th>
                <td>
                  <span className={styles.managedHeaderValue}>
                    {t(sourceKey, {
                      defaultValue:
                        'From the real incoming Claude CLI request; account fallback is used only before this core observes a compatible client.',
                    })}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint">
        {t('auth_files.account_settings_claude_header_strategy_hint', {
          defaultValue:
            'Claude does not pin one managed version on the account page. Multiple clients may use the same CPA instance, so concrete versions are shown below as recent current-process observations.',
        })}
      </div>
    </div>
  );
}

function ClaudeClientVersionObservationsPanel({
  observations,
  t,
}: {
  observations: AuthFileClientVersionObservation[];
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const rows = observations.slice(0, 8);
  const sourceLabel = (source: AuthFileClientVersionObservation['source']) => {
    if (typeof source === 'string') return source;
    if (source && typeof source === 'object') {
      const value = source.source;
      return typeof value === 'string' ? value : '';
    }
    return '';
  };

  return (
    <div className="form-group">
      <label>
        {t('auth_files.account_settings_claude_client_observations', {
          defaultValue: 'Recent Claude client observations',
        })}
      </label>
      <div
        className={styles.managedHeaderPanel}
        data-testid="account-settings-claude-client-observations-panel"
      >
        <div className={styles.managedHeaderPlainHeader}>
          <span>
            {t('auth_files.account_settings_claude_client_observations_runtime_title', {
              defaultValue: 'Observed by the current core process',
            })}
          </span>
          <span className={styles.managedHeaderMeta}>
            {t('auth_files.account_settings_claude_client_observations_count', {
              count: rows.length,
              defaultValue: '{{count}} versions',
            })}
          </span>
        </div>
        {rows.length > 0 ? (
          <table className={styles.managedHeaderTable}>
            <thead>
              <tr>
                <th>
                  {t('auth_files.account_settings_claude_client_version', {
                    defaultValue: 'Version',
                  })}
                </th>
                <th>
                  {t('auth_files.account_settings_claude_client_user_agent', {
                    defaultValue: 'User-Agent',
                  })}
                </th>
                <th>
                  {t('auth_files.account_settings_claude_client_last_seen', {
                    defaultValue: 'Last seen',
                  })}
                </th>
                <th>
                  {t('auth_files.account_settings_claude_client_requests', {
                    defaultValue: 'Requests',
                  })}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((observation, index) => (
                <tr
                  data-testid="account-settings-claude-client-observation-row"
                  key={`${observation.version || 'unknown'}-${observation.user_agent || index}`}
                >
                  <th scope="row" className={styles.managedHeaderKey}>
                    {observation.version || '-'}
                    <span className={styles.clientObservationSubtext}>
                      {[observation.package_version, observation.runtime_version]
                        .filter(Boolean)
                        .join(' · ') || '-'}
                    </span>
                  </th>
                  <td>
                    <code className={styles.managedHeaderValue} title={observation.user_agent}>
                      {observation.user_agent || '-'}
                    </code>
                    <span className={styles.clientObservationSubtext}>
                      {[observation.os, observation.arch, sourceLabel(observation.source)]
                        .filter(Boolean)
                        .join(' · ') || '-'}
                    </span>
                  </td>
                  <td>
                    <code
                      className={styles.managedHeaderValue}
                      title={observation.last_seen_at || observation.first_seen_at}
                    >
                      {observation.last_seen_at || observation.first_seen_at || '-'}
                    </code>
                  </td>
                  <td>
                    <code className={styles.managedHeaderValue}>
                      {String(observation.request_count || 0)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div
            className={styles.managedHeaderEmpty}
            data-testid="account-settings-claude-client-observations-empty"
          >
            {t('auth_files.account_settings_claude_client_observations_empty', {
              defaultValue:
                'No real Claude CLI request has been observed by this core process yet.',
            })}
          </div>
        )}
      </div>
      <div className="hint">
        {t('auth_files.account_settings_claude_client_observations_hint', {
          defaultValue:
            'Claude runtime resolves request version markers from real incoming Claude CLI requests first. This list is recent in-memory observation for this core process, not a fixed per-account managed version and not a complete audit log of every client.',
        })}
      </div>
    </div>
  );
}

function EditableJsonCodeField({
  value,
  placeholder,
  disabled,
  invalid,
  testId,
  theme,
  onChange,
}: {
  value: string;
  placeholder: string;
  disabled: boolean;
  invalid: boolean;
  testId: string;
  theme: 'light' | 'dark';
  onChange: (value: string) => void;
}) {
  const extensions = useMemo(
    () => [json(), search(), highlightSelectionMatches(), keymap.of(searchKeymap)],
    []
  );

  return (
    <div
      className={`${styles.accountSettingsJsonEditor} ${
        invalid ? styles.accountSettingsJsonEditorInvalid : ''
      }`}
      data-testid={`${testId}-wrapper`}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={theme}
        editable={!disabled}
        placeholder={placeholder}
        minHeight="112px"
        data-testid={testId}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          rectangularSelection: true,
          crosshairCursor: false,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          searchKeymap: true,
          foldKeymap: true,
          completionKeymap: false,
          lintKeymap: true,
        }}
      />
    </div>
  );
}

function parseRecordText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readString(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : '-';
}

function readBooleanLabel(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key];
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return '-';
}

function RuntimeTlsSummary({
  runtimeProfileText,
  runtimeIdentityText,
}: {
  runtimeProfileText: string;
  runtimeIdentityText: string;
}) {
  const runtimeProfile = parseRecordText(runtimeProfileText);
  const runtimeIdentity = parseRecordText(runtimeIdentityText);
  const identityCurrent = isRecord(runtimeIdentity?.current) ? runtimeIdentity.current : null;
  const provider = readString(runtimeProfile, 'provider');
  const tlsStatus = readString(runtimeProfile, 'tls_status');
  const transportStatus = readString(runtimeProfile, 'transport_status');
  const isClaude = provider.toLowerCase() === 'claude';
  const isCodex = provider.toLowerCase() === 'codex';

  if (!runtimeProfile && !identityCurrent) {
    return null;
  }

  return (
    <div className={styles.runtimeTlsSummaryPanel} data-testid="account-settings-tls-summary-panel">
      <div className={styles.runtimeTlsSummaryHeader}>
        <strong>Current runtime identity</strong>
        <div className={styles.runtimeTlsSummaryBadges}>
          <span>{readString(runtimeProfile, 'profile_id')}</span>
          <span>{readString(runtimeProfile, 'tls_profile_id')}</span>
          {runtimeProfile?.core_managed === true && <span>Core managed</span>}
          <span>Go approximation</span>
        </div>
      </div>
      <div className={styles.runtimeTlsSummaryGrid}>
        <div>
          <span>Provider</span>
          <strong>{provider}</strong>
        </div>
        <div>
          <span>TLS family</span>
          <strong>{readString(runtimeProfile, 'tls_family')}</strong>
        </div>
        <div>
          <span>Runtime enforced</span>
          <strong>{readBooleanLabel(runtimeProfile, 'tls_configured')}</strong>
        </div>
        <div>
          <span>Identity revision</span>
          <strong>{String(identityCurrent?.revision ?? '-')}</strong>
        </div>
        <div>
          <span>Source</span>
          <strong>{readString(runtimeProfile, 'source')}</strong>
        </div>
        <div>
          <span>Host</span>
          <strong>{readString(identityCurrent, 'base_url_host')}</strong>
        </div>
      </div>
      <div className={styles.runtimeTlsSummaryText}>
        {isClaude && (
          <p>
            Claude Code default is <strong>claude_reqwest_rustls_compatible_v1</strong>: a
            Claude-specific CLI profile modeled after reqwest/rustls behavior. Chrome-like uTLS
            presets are advanced opt-in only.
          </p>
        )}
        {isCodex && (
          <p>
            Codex default is <strong>codex_proxy_compatible_v1</strong>: a codex-proxy-compatible
            profile using core-managed headers and account-isolated transport.
          </p>
        )}
        <p>{tlsStatus}</p>
        <p>{transportStatus}</p>
      </div>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatHistoryValue(value: unknown): string {
  if (value === undefined) return '-';
  if (value === null) return 'null';
  if (typeof value === 'string') return value || '""';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getHistoryMapValue(
  map: Record<string, unknown> | undefined,
  field: string
): unknown {
  if (!map) return undefined;

  const fieldVariants = [
    field,
    field.replace(/^versioned_capabilities\./, ''),
    field.replace(/^summary_headers\./, ''),
    field.replace(/^managed_headers\./, ''),
    field.replace(/^headers\./, ''),
  ];

  for (const variant of fieldVariants) {
    if (Object.prototype.hasOwnProperty.call(map, variant)) {
      return map[variant];
    }
  }

  return undefined;
}

function getHistoryValue(
  entry: AuthFileManagedHeaderHistoryEntry,
  field: string,
  side: 'previous' | 'next'
): unknown {
  const versionedMap =
    side === 'previous'
      ? entry.previous_versioned_capabilities
      : entry.next_versioned_capabilities;
  const versionedValue = getHistoryMapValue(versionedMap, field);
  if (versionedValue !== undefined) return versionedValue;

  const genericMap = entry[side];
  return getHistoryMapValue(isRecord(genericMap) ? genericMap : undefined, field);
}

function buildHistoryDiffRows(
  entry: AuthFileManagedHeaderHistoryEntry
): ManagedHeaderHistoryDiffRow[] {
  const previousVersionedKeys = Object.keys(entry.previous_versioned_capabilities || {});
  const nextVersionedKeys = Object.keys(entry.next_versioned_capabilities || {});
  const mapBackedFields = [...previousVersionedKeys, ...nextVersionedKeys];
  const changedFields = entry.changed_fields || [];
  const shouldPreferMapFields =
    mapBackedFields.length > 0 &&
    changedFields.some((field) => field === VERSIONED_CAPABILITIES_FIELD);
  const fields = Array.from(
    new Set(
      [
        ...mapBackedFields,
        ...changedFields.filter(
          (field) => !(shouldPreferMapFields && field === VERSIONED_CAPABILITIES_FIELD)
        ),
      ].filter(Boolean)
    )
  ).sort();

  return fields
    .map((field) => ({
      field,
      previous: getHistoryValue(entry, field, 'previous'),
      next: getHistoryValue(entry, field, 'next'),
    }))
    .filter((row) => row.previous !== undefined || row.next !== undefined);
}

export function AuthFilesPrefixProxyEditorModal(props: AuthFilesPrefixProxyEditorModalProps) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const { disableControls, editor, updatedText, dirty, onClose, onCopyText, onSave, onChange } =
    props;

  const managedHeaderState = editor?.managedHeaderState || null;
  const managedHeaderPolicy = managedHeaderState?.policy_version || '';
  const managedHeaderPolicyMatch = managedHeaderPolicy.match(/^([a-z0-9_-]+)-managed\/v(\d+)$/i);
  const managedHeaderPolicyProvider = (managedHeaderPolicyMatch?.[1] || '').toLowerCase();
  const editorProvider = (editor?.provider || '').toLowerCase();
  const isClaudeProvider = editorProvider === 'claude' || managedHeaderPolicyProvider === 'claude';
  const isClaudeManagedPolicy =
    isClaudeProvider ||
    (editor?.clientVersionObservations || []).length > 0;
  const managedHeaderPolicyVersion = managedHeaderPolicyMatch?.[2]
    ? `v${managedHeaderPolicyMatch[2]}`
    : managedHeaderPolicy || '-';
  const managedHeaderPolicyStrategy =
    isClaudeManagedPolicy
      ? t('auth_files.account_settings_managed_header_policy_strategy_claude', {
          defaultValue: 'Claude core-managed request headers',
        })
      : managedHeaderPolicyProvider === 'codex'
        ? t('auth_files.account_settings_managed_header_policy_strategy_codex', {
            defaultValue: 'Codex core-managed request headers',
          })
        : t('auth_files.account_settings_managed_header_policy_strategy_generic', {
            defaultValue: 'Core-managed request headers',
          });
  const managedHeaderPolicyRule =
    isClaudeManagedPolicy
      ? t('auth_files.account_settings_managed_header_policy_rule_claude', {
          defaultValue:
            'Core resolves Claude CLI version markers from real incoming client requests first; fallback defaults are used only when this core has not observed a compatible client.',
        })
      : managedHeaderPolicyProvider === 'codex'
        ? t('auth_files.account_settings_managed_header_policy_rule_codex', {
            defaultValue:
              'Core may refresh Codex Desktop-like headers from an allowlisted codex-proxy coherent bundle. It must not mix npm CLI versions into the Desktop UA.',
          })
        : t('auth_files.account_settings_managed_header_policy_rule_generic', {
            defaultValue:
              'Core may refresh version-sensitive generated fields while keeping stable identity fields unchanged.',
          });
  const managedHeaderEntries = Object.entries(editor?.managedHeaders || {}).sort(
    ([left], [right]) => left.localeCompare(right)
  );
  const managedHeaderCurrent = managedHeaderState?.current || null;
  const managedHeaderGeneratedAt = managedHeaderState?.current?.generated_at || '';
  const managedHeaderSource = managedHeaderCurrent?.source || '';
  const managedHeaderSourceUrl = managedHeaderCurrent?.source_url || '';
  const managedHeaderCheckedAt = managedHeaderCurrent?.checked_at || '';
  const managedHeaderCompleteness = managedHeaderCurrent?.completeness || '';
  const managedHeaderSourceLabel = (() => {
    if (
      managedHeaderSource === 'community:codex-proxy' &&
      managedHeaderCompleteness === 'online-coherent-bundle'
    ) {
      return t('auth_files.account_settings_managed_header_source_codex_proxy_online', {
        defaultValue: 'Online coherent bundle from codex-proxy',
      });
    }
    if (managedHeaderSource === 'community:codex-proxy') {
      return t('auth_files.account_settings_managed_header_source_codex_proxy', {
        defaultValue: 'Community codex-proxy strategy',
      });
    }
    if (
      managedHeaderSource === 'online:npm' &&
      managedHeaderCompleteness === 'partial-cli-version-only'
    ) {
      return t('auth_files.account_settings_managed_header_source_online_npm_partial', {
        defaultValue: 'Online npm version only',
      });
    }
    if (managedHeaderSource === 'online:npm') {
      return t('auth_files.account_settings_managed_header_source_online_npm', {
        defaultValue: 'Online verified via npm registry',
      });
    }
    if (managedHeaderSource === 'observed:first_party') {
      return t('auth_files.account_settings_managed_header_source_observed', {
        defaultValue: 'Observed from a real client request',
      });
    }
    if (managedHeaderSource === 'default') {
      return t('auth_files.account_settings_managed_header_source_default', {
        defaultValue: 'Default strategy, not online-verified',
      });
    }
    return managedHeaderSource || '-';
  })();
  const managedVersionedFields = Object.keys(
    managedHeaderState?.current?.versioned_capabilities || {}
  ).sort();
  const managedStableFields = Object.keys(
    managedHeaderState?.current?.stable_identity || {}
  ).sort();
  const managedRuntimeFields = Object.keys(
    managedHeaderState?.current?.runtime_fingerprint || {}
  ).sort();
  const managedHistory = managedHeaderState?.history || [];
  const managedLatestHistory = managedHistory[managedHistory.length - 1] || null;
  const formatFieldList = (fields: string[]) =>
    fields.length > 0
      ? fields.join(', ')
      : t('auth_files.account_settings_managed_header_none', {
          defaultValue: 'None',
        });

  return (
    <Modal
      open={Boolean(editor)}
      onClose={onClose}
      closeDisabled={editor?.saving === true}
      width={760}
      title={
        editor?.fileName
          ? t('auth_files.auth_field_editor_title', {
              name: editor.fileName,
              defaultValue: `Account settings · ${editor.fileName}`,
            })
          : t('auth_files.prefix_proxy_button')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={editor?.saving === true}>
            {dirty ? t('common.cancel') : t('common.close')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!updatedText) return;
              void onCopyText(updatedText);
            }}
            disabled={editor?.saving === true || !updatedText}
          >
            {t('common.copy')}
          </Button>
          <Button
            onClick={onSave}
            loading={editor?.saving === true}
            disabled={
              disableControls ||
              editor?.saving === true ||
              !dirty ||
              Boolean(editor?.extraHeadersError) ||
              Boolean(editor?.transportProfileError) ||
              Boolean(editor?.tlsProfileError)
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {editor && (
        <div className={styles.prefixProxyEditor}>
          {editor.loading ? (
            <div className={styles.prefixProxyLoading}>
              <LoadingSpinner size={14} />
              <span>
                {t('auth_files.prefix_proxy_loading', {
                  defaultValue: 'Loading account settings…',
                })}
              </span>
            </div>
          ) : (
            <>
              {editor.error && <div className={styles.prefixProxyError}>{editor.error}</div>}

              {isClaudeManagedPolicy ? (
                <ClaudeHeaderStrategyPanel t={t} />
              ) : (
                <ManagedHeadersPanel entries={managedHeaderEntries} t={t} />
              )}

              {isClaudeManagedPolicy && (
                <ClaudeClientVersionObservationsPanel
                  observations={editor.clientVersionObservations}
                  t={t}
                />
              )}

              <details
                className={styles.prefixProxyAdvancedDetails}
                data-testid="account-settings-raw-json-details"
              >
                <summary>
                  {t('auth_files.account_settings_raw_json_details', {
                    defaultValue: 'Advanced raw JSON preview',
                  })}
                </summary>
                <div className={styles.prefixProxyAdvancedBody}>
                  <div className={styles.prefixProxyJsonWrapper}>
                    <label className={styles.prefixProxyLabel}>
                      {t('auth_files.prefix_proxy_info_label', {
                        defaultValue: 'Auth file summary',
                      })}
                    </label>
                    <ReadOnlyCodeViewer
                      value={editor.fileInfoText}
                      minRows={6}
                      testId="account-settings-auth-file-info-viewer"
                      label={t('common.readonly', { defaultValue: 'Read only' })}
                      onCopyText={onCopyText}
                    />
                    <div className="hint">
                      {t('auth_files.prefix_proxy_info_hint', {
                        defaultValue:
                          'Read-only snapshot of the auth file metadata. Edit account settings below.',
                      })}
                    </div>
                  </div>

                  <div className={styles.prefixProxyJsonWrapper}>
                    <label className={styles.prefixProxyLabel}>
                      {t('auth_files.prefix_proxy_source_label', {
                        defaultValue: 'Save payload preview',
                      })}
                    </label>
                    <ReadOnlyCodeViewer
                      value={updatedText}
                      minRows={8}
                      testId="account-settings-save-payload-preview"
                      label={t('common.readonly', { defaultValue: 'Read only' })}
                      onCopyText={onCopyText}
                    />
                    <div className="hint">
                      {t('auth_files.prefix_proxy_source_hint', {
                        defaultValue:
                          'Read-only preview of the payload that Save will send. Editable fields are labeled below.',
                      })}
                    </div>
                  </div>
                </div>
              </details>

              <div className={styles.prefixProxyFields}>
                <div className="form-group">
                  <label>
                    {t('auth_files.status_toggle_label', { defaultValue: 'Enabled' })}
                  </label>
                  <ToggleSwitch
                    checked={!editor.disabled}
                    disabled={disableControls || editor.saving}
                    testId="account-settings-enabled-toggle"
                    ariaLabel={t('auth_files.status_toggle_label', {
                      defaultValue: 'Enabled',
                    })}
                    onChange={(enabled) => onChange('disabled', !enabled)}
                  />
                  <div className="hint">
                    {t('auth_files.account_settings_enabled_hint', {
                      defaultValue:
                        'On means this account can be selected by runtime. Turning it off writes disabled=true without deleting data.',
                    })}
                  </div>
                </div>

                <div className="form-group">
                  <label>
                    {t('auth_files.account_settings_refresh_enabled', {
                      defaultValue: 'Automatic token refresh',
                    })}
                  </label>
                  <ToggleSwitch
                    checked={editor.refreshEnabled}
                    disabled={disableControls || editor.saving}
                    testId="account-settings-refresh-enabled-toggle"
                    ariaLabel={t('auth_files.account_settings_refresh_enabled', {
                      defaultValue: 'Automatic token refresh',
                    })}
                    onChange={(value) => onChange('refreshEnabled', value)}
                  />
                  <div className="hint">
                    {t('auth_files.account_settings_refresh_enabled_hint', {
                      defaultValue:
                        'Keep enabled for normal accounts. Turn it off only for access-token-only testing or controlled migration so this core will not use a refresh token held by another runtime.',
                    })}
                  </div>
                </div>

                <Input
                  label={t('auth_files.proxy_url_label')}
                  value={editor.proxyUrl}
                  placeholder={t('auth_files.proxy_url_placeholder')}
                  disabled={disableControls || editor.saving}
                  onChange={(e) => onChange('proxyUrl', e.target.value)}
                />

                <Input
                  label={t('auth_files.note_label')}
                  value={editor.note}
                  placeholder={t('auth_files.note_placeholder')}
                  hint={t('auth_files.note_hint')}
                  disabled={disableControls || editor.saving}
                  onChange={(e) => onChange('note', e.target.value)}
                />

                {(managedHeaderPolicy ||
                  managedVersionedFields.length > 0 ||
                  managedStableFields.length > 0 ||
                  managedRuntimeFields.length > 0) && (
                  <div className="form-group">
                    <label>
                      {t('auth_files.account_settings_managed_header_policy', {
                        defaultValue: 'Core auto-upgrade policy state',
                      })}
                    </label>
                    <div
                      className={styles.managedHeaderPanel}
                      data-testid="account-settings-managed-policy-panel"
                    >
                      <div className={styles.managedHeaderPolicyGrid}>
                        {managedHeaderPolicy && (
                          <div className={styles.managedHeaderPolicyItem}>
                            <span>
                              {t('auth_files.account_settings_managed_header_policy_strategy', {
                                defaultValue: 'Managed strategy',
                              })}
                            </span>
                            <strong>{managedHeaderPolicyStrategy}</strong>
                          </div>
                        )}
                        {managedHeaderPolicy && (
                          <div className={styles.managedHeaderPolicyItem}>
                            <span>
                              {t('auth_files.account_settings_managed_header_policy_version', {
                                defaultValue: 'Strategy version',
                              })}
                            </span>
                            <strong>{managedHeaderPolicyVersion}</strong>
                          </div>
                        )}
                        {managedHeaderPolicy && (
                          <div className={styles.managedHeaderPolicyItem}>
                            <span>
                              {t('auth_files.account_settings_managed_header_policy_internal_id', {
                                defaultValue: 'Internal policy ID',
                              })}
                            </span>
                            <strong>{managedHeaderPolicy}</strong>
                          </div>
                        )}
                        {managedHeaderPolicy && (
                          <div
                            className={`${styles.managedHeaderPolicyItem} ${styles.managedHeaderPolicyItemWide}`}
                            data-testid="account-settings-managed-policy-rule"
                          >
                            <span>
                              {t('auth_files.account_settings_managed_header_policy_rule', {
                                defaultValue: 'Auto-update rule',
                              })}
                            </span>
                            <strong>{managedHeaderPolicyRule}</strong>
                          </div>
                        )}
                        {(managedHeaderSource ||
                          managedHeaderCheckedAt ||
                          managedHeaderSourceUrl ||
                          managedHeaderCompleteness) && (
                          <div
                            className={`${styles.managedHeaderPolicyItem} ${styles.managedHeaderPolicyItemWide}`}
                            data-testid="account-settings-managed-source"
                          >
                            <span>
                              {t('auth_files.account_settings_managed_header_source', {
                                defaultValue: 'Version source',
                              })}
                            </span>
                            <strong>
                              {[
                                managedHeaderSourceLabel,
                                managedHeaderCheckedAt
                                  ? t(
                                      'auth_files.account_settings_managed_header_source_checked_at',
                                      {
                                        checkedAt: managedHeaderCheckedAt,
                                        defaultValue: 'checked {{checkedAt}}',
                                      }
                                    )
                                  : '',
                                managedHeaderCompleteness
                                  ? t(
                                      'auth_files.account_settings_managed_header_source_completeness',
                                      {
                                        completeness: managedHeaderCompleteness,
                                        defaultValue: 'completeness {{completeness}}',
                                      }
                                    )
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                              {managedHeaderSourceUrl ? ` · ${managedHeaderSourceUrl}` : ''}
                            </strong>
                          </div>
                        )}
                        {managedHeaderGeneratedAt && (
                          <div className={styles.managedHeaderPolicyItem}>
                            <span>
                              {t('auth_files.account_settings_managed_header_generated_at', {
                                defaultValue: 'Generated at',
                              })}
                            </span>
                            <strong>{managedHeaderGeneratedAt}</strong>
                          </div>
                        )}
                        <div className={styles.managedHeaderPolicyItem}>
                          <span>
                            {t('auth_files.account_settings_managed_header_versions', {
                              defaultValue: 'Fields core may auto-bump',
                            })}
                          </span>
                          <strong>{formatFieldList(managedVersionedFields)}</strong>
                        </div>
                        <div className={styles.managedHeaderPolicyItem}>
                          <span>
                            {t('auth_files.account_settings_managed_header_stable_identity', {
                              defaultValue: 'Fields pinned across version bumps',
                            })}
                          </span>
                          <strong>{formatFieldList(managedStableFields)}</strong>
                        </div>
                        <div className={styles.managedHeaderPolicyItem}>
                          <span>
                            {t('auth_files.account_settings_managed_header_runtime', {
                              defaultValue: 'Runtime environment signals',
                            })}
                          </span>
                          <strong>{formatFieldList(managedRuntimeFields)}</strong>
                        </div>
                        <div className={styles.managedHeaderPolicyItem}>
                          <span>
                            {t('auth_files.account_settings_managed_header_history_count', {
                              defaultValue: 'Recorded upgrades',
                            })}
                          </span>
                          <strong>
                            {t('auth_files.account_settings_managed_header_history_count_value', {
                              count: managedHistory.length,
                              defaultValue: '{{count}} entries',
                            })}
                          </strong>
                        </div>
                        {managedLatestHistory && (
                          <div className={styles.managedHeaderPolicyItem}>
                            <span>
                              {t('auth_files.account_settings_managed_header_latest_change', {
                                defaultValue: 'Latest changed fields',
                              })}
                            </span>
                            <strong>
                              {formatFieldList(managedLatestHistory.changed_fields || [])}
                            </strong>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="hint">
                      {t('auth_files.account_settings_managed_header_policy_hint', {
                        defaultValue:
                          'This is not another header editor. It explains which parts of the generated headers core is allowed to update automatically.',
                      })}
                    </div>
                  </div>
                )}

                {managedHistory.length > 0 && (
                  <div className="form-group">
                    <label>
                      {t('auth_files.account_settings_managed_header_history', {
                        defaultValue: 'Managed header upgrade history',
                      })}
                    </label>
                    <div
                      className={styles.managedHeaderPanel}
                      data-testid="account-settings-managed-history-panel"
                    >
                      <div className={styles.managedHeaderHistoryList}>
                        {managedHistory.map((entry, index) => (
                          <div
                            className={styles.managedHeaderHistoryEntry}
                            key={`${entry.recorded_at || index}-${index}`}
                          >
                            <div className={styles.managedHeaderHistorySummary}>
                              <div className={styles.managedHeaderHistoryMeta}>
                                <strong>{entry.recorded_at || '-'}</strong>
                                <span>{entry.reason || 'managed-header-refresh'}</span>
                                <span>{entry.policy_version || '-'}</span>
                                {(entry.source || entry.source_url) && (
                                  <span>
                                    {[entry.source, entry.source_url].filter(Boolean).join(' · ')}
                                  </span>
                                )}
                              </div>
                              <div className={styles.managedHeaderChips}>
                                {(entry.changed_fields || []).length > 0 ? (
                                  (entry.changed_fields || []).map((field) => (
                                    <span
                                      className={styles.managedHeaderChip}
                                      key={field}
                                      title={field}
                                    >
                                      {field}
                                    </span>
                                  ))
                                ) : (
                                  <span className={styles.managedHeaderChip}>
                                    {t(
                                      'auth_files.account_settings_managed_header_history_no_diff',
                                      {
                                        defaultValue: 'No field-level diff recorded',
                                      }
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                            <details
                              className={styles.managedHeaderHistoryDetails}
                              data-testid="account-settings-managed-history-details"
                            >
                              <summary
                                className={styles.managedHeaderHistoryToggle}
                                data-testid="account-settings-managed-history-details-toggle"
                              >
                                {t(
                                  'auth_files.account_settings_managed_header_history_view_changes',
                                  {
                                    defaultValue: 'View changes',
                                  }
                                )}
                              </summary>
                              <div className={styles.managedHeaderHistoryDetailGrid}>
                                <div className={styles.managedHeaderHistoryDetailItem}>
                                  <span>
                                    {t(
                                      'auth_files.account_settings_managed_header_history_recorded_at',
                                      {
                                        defaultValue: 'Recorded at',
                                      }
                                    )}
                                  </span>
                                  <strong>{entry.recorded_at || '-'}</strong>
                                </div>
                                <div className={styles.managedHeaderHistoryDetailItem}>
                                  <span>
                                    {t(
                                      'auth_files.account_settings_managed_header_history_reason',
                                      {
                                        defaultValue: 'Reason',
                                      }
                                    )}
                                  </span>
                                  <strong>{entry.reason || 'managed-header-refresh'}</strong>
                                </div>
                                <div className={styles.managedHeaderHistoryDetailItem}>
                                  <span>
                                    {t(
                                      'auth_files.account_settings_managed_header_history_policy_version',
                                      {
                                        defaultValue: 'Policy version',
                                      }
                                    )}
                                  </span>
                                  <strong>{entry.policy_version || '-'}</strong>
                                </div>
                                <div className={styles.managedHeaderHistoryDetailItem}>
                                  <span>
                                    {t(
                                      'auth_files.account_settings_managed_header_history_source',
                                      {
                                        defaultValue: 'Source',
                                      }
                                    )}
                                  </span>
                                  <strong>
                                    {[entry.source, entry.source_url].filter(Boolean).join(' · ') ||
                                      '-'}
                                  </strong>
                                </div>
                                <div
                                  className={`${styles.managedHeaderHistoryDetailItem} ${styles.managedHeaderHistoryDetailItemWide}`}
                                >
                                  <span>
                                    {t(
                                      'auth_files.account_settings_managed_header_history_changed_fields',
                                      {
                                        defaultValue: 'Changed fields',
                                      }
                                    )}
                                  </span>
                                  <strong>{formatFieldList(entry.changed_fields || [])}</strong>
                                </div>
                              </div>
                              {buildHistoryDiffRows(entry).length > 0 ? (
                                <div
                                  className={styles.managedHeaderHistoryDiffTable}
                                  data-testid="account-settings-managed-history-diff-table"
                                >
                                  <div className={styles.managedHeaderHistoryDiffHead}>
                                    {t(
                                      'auth_files.account_settings_managed_header_history_field',
                                      {
                                        defaultValue: 'Field',
                                      }
                                    )}
                                  </div>
                                  <div className={styles.managedHeaderHistoryDiffHead}>
                                    {t(
                                      'auth_files.account_settings_managed_header_history_previous',
                                      {
                                        defaultValue: 'Previous',
                                      }
                                    )}
                                  </div>
                                  <div className={styles.managedHeaderHistoryDiffHead}>
                                    {t(
                                      'auth_files.account_settings_managed_header_history_next',
                                      {
                                        defaultValue: 'Next',
                                      }
                                    )}
                                  </div>
                                  {buildHistoryDiffRows(entry).map((row) => (
                                    <div
                                      className={styles.managedHeaderHistoryDiffRow}
                                      key={row.field}
                                    >
                                      <span>{row.field}</span>
                                      <code title={formatHistoryValue(row.previous)}>
                                        {formatHistoryValue(row.previous)}
                                      </code>
                                      <code title={formatHistoryValue(row.next)}>
                                        {formatHistoryValue(row.next)}
                                      </code>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div
                                  className={styles.managedHeaderHistoryNoDiff}
                                  data-testid="account-settings-managed-history-no-diff"
                                >
                                  {t(
                                    'auth_files.account_settings_managed_header_history_no_diff',
                                    {
                                      defaultValue: 'No field-level diff recorded',
                                    }
                                  )}
                                </div>
                              )}
                            </details>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="hint">
                      {t('auth_files.account_settings_managed_header_history_hint', {
                        defaultValue:
                          'Append-only history for core-driven upgrades. It records which generated fields changed; it is not user editable.',
                      })}
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label>
                    {t('auth_files.account_settings_extra_headers', {
                      defaultValue: 'Extra headers (advanced)',
                    })}
                  </label>
                  <EditableJsonCodeField
                    value={editor.extraHeadersText}
                    placeholder={`{\n  "X-Team": "core"\n}`}
                    invalid={Boolean(editor.extraHeadersError)}
                    disabled={disableControls || editor.saving}
                    testId="account-settings-extra-headers-editor"
                    theme={resolvedTheme}
                    onChange={(value) => onChange('extraHeadersText', value)}
                  />
                  {editor.extraHeadersError && (
                    <div className="error-box">{editor.extraHeadersError}</div>
                  )}
                  <div
                    className={styles.accountSettingsJsonExample}
                    data-testid="account-settings-extra-headers-example"
                  >
                    <span>
                      {t('auth_files.account_settings_extra_headers_example_label', {
                        defaultValue: 'Example',
                      })}
                    </span>
                    <code>{'{ "X-Team": "core" }'}</code>
                  </div>
                  <div className="hint">
                    {t('auth_files.account_settings_extra_headers_hint', {
                      defaultValue:
                        'Editable JSON for user-owned additive headers only. Do not copy core-managed provider/version headers here; conflicts with managed or protocol-reserved headers are rejected by the core API.',
                    })}
                  </div>
                </div>

                {(editor.runtimeProfileText || editor.runtimeIdentityText) && (
                  <RuntimeTlsSummary
                    runtimeProfileText={editor.runtimeProfileText}
                    runtimeIdentityText={editor.runtimeIdentityText}
                  />
                )}

                {editor.runtimeProfileText && (
                  <div className="form-group">
                    <label>
                      {t('auth_files.account_settings_runtime_profile', {
                        defaultValue: 'Runtime profile summary',
                      })}
                    </label>
                    <ReadOnlyCodeViewer
                      value={editor.runtimeProfileText}
                      minRows={8}
                      testId="account-settings-runtime-profile-viewer"
                      label={t('common.readonly', { defaultValue: 'Read only' })}
                      onCopyText={onCopyText}
                    />
                    <div className="hint">
                      {t('auth_files.account_settings_runtime_profile_hint', {
                        defaultValue:
                          'Resolved by the core for this account. Claude defaults to a reqwest/rustls-compatible CLI profile; Chrome-like uTLS remains advanced explicit opt-in only.',
                      })}
                    </div>
                  </div>
                )}

                {editor.runtimeIdentityText && (
                  <div className="form-group">
                    <label>
                      {t('auth_files.account_settings_runtime_identity', {
                        defaultValue: 'Core-generated account TLS identity',
                      })}
                    </label>
                    <ReadOnlyCodeViewer
                      value={editor.runtimeIdentityText}
                      minRows={10}
                      testId="account-settings-runtime-identity-viewer"
                      label={t('common.readonly', { defaultValue: 'Read only' })}
                      onCopyText={onCopyText}
                    />
                    <div className="hint">
                      {t('auth_files.account_settings_runtime_identity_hint', {
                        defaultValue:
                          'Read-only account identity generated and versioned by the core. It stores stable identity hashes, profile source, revision, and history so users do not manually create TLS identities.',
                      })}
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label>
                    {t('auth_files.account_settings_transport_profile', {
                      defaultValue: 'Transport profile',
                    })}
                  </label>
                  <EditableJsonCodeField
                    value={editor.transportProfileText}
                    placeholder={`Leave empty for core default transport.\nClaude CLI example:\n{\n  "preset": "claude_reqwest_rustls_compatible_v1"\n}`}
                    invalid={Boolean(editor.transportProfileError)}
                    disabled={disableControls || editor.saving}
                    testId="account-settings-transport-profile-editor"
                    theme={resolvedTheme}
                    onChange={(value) => onChange('transportProfileText', value)}
                  />
                  {editor.transportProfileError && (
                    <div className="error-box">{editor.transportProfileError}</div>
                  )}
                  <div className="hint">
                    {t('auth_files.account_settings_transport_profile_hint', {
                      defaultValue:
                        'Leave empty for the core default transport. Claude defaults to a Claude-specific reqwest/rustls-compatible CLI profile based on community implementations; Chrome-like uTLS presets such as claude_utls_chrome_133 are advanced opt-in only. Codex follows codex-proxy-compatible transport with Go approximation until the Rust sidecar is added.',
                    })}
                  </div>
                </div>

                <div className="form-group">
                  <label>
                    {t('auth_files.account_settings_tls_profile', {
                      defaultValue: 'TLS profile',
                    })}
                  </label>
                  <EditableJsonCodeField
                    value={editor.tlsProfileText}
                    placeholder={`Leave empty for core default TLS.\nClaude CLI example:\n{\n  "preset": "claude_reqwest_rustls_compatible_v1"\n}`}
                    invalid={Boolean(editor.tlsProfileError)}
                    disabled={disableControls || editor.saving}
                    testId="account-settings-tls-profile-editor"
                    theme={resolvedTheme}
                    onChange={(value) => onChange('tlsProfileText', value)}
                  />
                  {editor.tlsProfileError && (
                    <div className="error-box">{editor.tlsProfileError}</div>
                  )}
                  <div className="hint">
                    {t('auth_files.account_settings_tls_profile_hint', {
                      defaultValue:
                        'Leave empty for the core default TLS behavior. Claude default uses reqwest/rustls-compatible CLI semantics via Go approximation; old Chrome-like aliases remain explicit advanced opt-in only. Codex can enforce Go transport knobs, but exact Rust wire parity is not shipped yet.',
                    })}
                  </div>
                </div>

                {editor.warnings.length > 0 && (
                  <div className="form-group">
                    <label>
                      {t('auth_files.account_settings_warnings', {
                        defaultValue: 'Warnings',
                      })}
                    </label>
                    <ReadOnlyCodeViewer
                      value={editor.warnings.join('\n')}
                      minRows={Math.max(3, editor.warnings.length + 1)}
                      testId="account-settings-warnings-viewer"
                      label={t('common.readonly', { defaultValue: 'Read only' })}
                      onCopyText={onCopyText}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
