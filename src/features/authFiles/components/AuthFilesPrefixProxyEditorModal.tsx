import { useTranslation } from 'react-i18next';
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

export function AuthFilesPrefixProxyEditorModal(props: AuthFilesPrefixProxyEditorModalProps) {
  const { t } = useTranslation();
  const { disableControls, editor, updatedText, dirty, onClose, onCopyText, onSave, onChange } =
    props;

  const managedHeadersPreview = editor?.managedHeaders
    ? JSON.stringify(editor.managedHeaders, null, 2)
    : '';
  const managedHeaderState = editor?.managedHeaderState || null;
  const managedHeaderPolicy = managedHeaderState?.policy_version || '';
  const managedVersionedPreview = managedHeaderState?.current?.versioned_capabilities
    ? JSON.stringify(managedHeaderState.current.versioned_capabilities, null, 2)
    : '';
  const managedStablePreview = managedHeaderState?.current?.stable_identity
    ? JSON.stringify(managedHeaderState.current.stable_identity, null, 2)
    : '';
  const managedRuntimePreview = managedHeaderState?.current?.runtime_fingerprint
    ? JSON.stringify(managedHeaderState.current.runtime_fingerprint, null, 2)
    : '';
  const managedHistoryPreview =
    managedHeaderState?.history && managedHeaderState.history.length > 0
      ? JSON.stringify(managedHeaderState.history, null, 2)
      : '';

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

              <div className={styles.prefixProxyJsonWrapper}>
                <label className={styles.prefixProxyLabel}>
                  {t('auth_files.prefix_proxy_info_label', {
                    defaultValue: 'Auth file summary',
                  })}
                </label>
                <textarea
                  className={styles.prefixProxyTextarea}
                  rows={6}
                  readOnly
                  value={editor.fileInfoText}
                />
              </div>

              <div className={styles.prefixProxyJsonWrapper}>
                <label className={styles.prefixProxyLabel}>
                  {t('auth_files.prefix_proxy_source_label', {
                    defaultValue: 'Save payload preview',
                  })}
                </label>
                <textarea
                  className={styles.prefixProxyTextarea}
                  rows={10}
                  readOnly
                  value={updatedText}
                />
              </div>

              <div className={styles.prefixProxyFields}>
                <div className="form-group">
                  <label>
                    {t('auth_files.status_toggle_label', { defaultValue: 'Disable account' })}
                  </label>
                  <ToggleSwitch
                    checked={editor.disabled}
                    disabled={disableControls || editor.saving}
                    ariaLabel={t('auth_files.status_toggle_label', {
                      defaultValue: 'Disable account',
                    })}
                    onChange={(value) => onChange('disabled', value)}
                  />
                  <div className="hint">
                    {t('auth_files.account_settings_disabled_hint', {
                      defaultValue: 'Disabling an account keeps data intact but removes it from runtime selection.',
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

                <div className="form-group">
                  <label>
                    {t('auth_files.account_settings_managed_headers', {
                      defaultValue: 'Managed headers (generated by core strategy)',
                    })}
                  </label>
                  <textarea
                    className={styles.prefixProxyTextarea}
                    rows={8}
                    readOnly
                    value={managedHeadersPreview}
                  />
                  <div className="hint">
                    {t('auth_files.account_settings_managed_headers_hint', {
                      defaultValue:
                        'These headers are owned by core policy and can change with provider/runtime strategy updates.',
                    })}
                  </div>
                </div>

                {managedHeaderPolicy && (
                  <div className="form-group">
                    <label>
                      {t('auth_files.account_settings_managed_header_policy', {
                        defaultValue: 'Managed header policy',
                      })}
                    </label>
                    <textarea
                      className={styles.prefixProxyTextarea}
                      rows={2}
                      readOnly
                      value={managedHeaderPolicy}
                    />
                    <div className="hint">
                      {t('auth_files.account_settings_managed_header_policy_hint', {
                        defaultValue:
                          'Core keeps managed headers split into version markers, stable identity, and runtime fingerprint fields.',
                      })}
                    </div>
                  </div>
                )}

                {managedVersionedPreview && (
                  <div className="form-group">
                    <label>
                      {t('auth_files.account_settings_managed_header_versions', {
                        defaultValue: 'Versioned capabilities (auto-bumped by core)',
                      })}
                    </label>
                    <textarea
                      className={styles.prefixProxyTextarea}
                      rows={6}
                      readOnly
                      value={managedVersionedPreview}
                    />
                    <div className="hint">
                      {t('auth_files.account_settings_managed_header_versions_hint', {
                        defaultValue:
                          'Only version markers should move during normal upgrades; this is the part core is allowed to refresh automatically.',
                      })}
                    </div>
                  </div>
                )}

                {managedStablePreview && (
                  <div className="form-group">
                    <label>
                      {t('auth_files.account_settings_managed_header_stable_identity', {
                        defaultValue: 'Stable identity (should not drift on version bumps)',
                      })}
                    </label>
                    <textarea
                      className={styles.prefixProxyTextarea}
                      rows={4}
                      readOnly
                      value={managedStablePreview}
                    />
                  </div>
                )}

                {managedRuntimePreview && (
                  <div className="form-group">
                    <label>
                      {t('auth_files.account_settings_managed_header_runtime', {
                        defaultValue:
                          'Runtime fingerprint (kept stable unless environment truly changes)',
                      })}
                    </label>
                    <textarea
                      className={styles.prefixProxyTextarea}
                      rows={4}
                      readOnly
                      value={managedRuntimePreview}
                    />
                  </div>
                )}

                {managedHistoryPreview && (
                  <div className="form-group">
                    <label>
                      {t('auth_files.account_settings_managed_header_history', {
                        defaultValue: 'Managed header history',
                      })}
                    </label>
                    <textarea
                      className={styles.prefixProxyTextarea}
                      rows={8}
                      readOnly
                      value={managedHistoryPreview}
                    />
                    <div className="hint">
                      {t('auth_files.account_settings_managed_header_history_hint', {
                        defaultValue:
                          'Core records append-only history before bumping managed version markers, so older capability markers remain inspectable.',
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
                  <textarea
                    className={`input ${editor.extraHeadersError ? styles.prefixProxyTextareaInvalid : ''}`}
                    value={editor.extraHeadersText}
                    placeholder={`{\n  "X-Team": "core"\n}`}
                    rows={8}
                    aria-invalid={Boolean(editor.extraHeadersError)}
                    disabled={disableControls || editor.saving}
                    onChange={(e) => onChange('extraHeadersText', e.target.value)}
                  />
                  {editor.extraHeadersError && (
                    <div className="error-box">{editor.extraHeadersError}</div>
                  )}
                  <div className="hint">
                    {t('auth_files.account_settings_extra_headers_hint', {
                      defaultValue:
                        'Use only for additive headers. Conflicts with managed/protocol-reserved headers are rejected by the core API.',
                    })}
                  </div>
                </div>

                <div className="form-group">
                  <label>
                    {t('auth_files.account_settings_transport_profile', {
                      defaultValue: 'Transport profile',
                    })}
                  </label>
                  <textarea
                    className={`input ${editor.transportProfileError ? styles.prefixProxyTextareaInvalid : ''}`}
                    value={editor.transportProfileText}
                    placeholder={`{\n  "preset": "claude_chrome_like_mac_v3"\n}`}
                    rows={4}
                    aria-invalid={Boolean(editor.transportProfileError)}
                    disabled={disableControls || editor.saving}
                    onChange={(e) => onChange('transportProfileText', e.target.value)}
                  />
                  {editor.transportProfileError && (
                    <div className="error-box">{editor.transportProfileError}</div>
                  )}
                  <div className="hint">
                    {t('auth_files.account_settings_transport_profile_hint', {
                      defaultValue:
                        'Claude presets are runtime-enforced via core uTLS. Codex presets currently enforce account-scoped transport isolation only; they do not emulate the official Codex rustls TLS fingerprint yet.',
                    })}
                  </div>
                </div>

                <div className="form-group">
                  <label>
                    {t('auth_files.account_settings_tls_profile', {
                      defaultValue: 'TLS profile (reserved)',
                    })}
                  </label>
                  <textarea
                    className={`input ${editor.tlsProfileError ? styles.prefixProxyTextareaInvalid : ''}`}
                    value={editor.tlsProfileText}
                    placeholder={`{\n  "preset": "future"\n}`}
                    rows={4}
                    aria-invalid={Boolean(editor.tlsProfileError)}
                    disabled={disableControls || editor.saving}
                    onChange={(e) => onChange('tlsProfileText', e.target.value)}
                  />
                  {editor.tlsProfileError && (
                    <div className="error-box">{editor.tlsProfileError}</div>
                  )}
                  <div className="hint">
                    {t('auth_files.account_settings_tls_profile_hint', {
                      defaultValue:
                        'Schema/API reserved only. Do not interpret this as full runtime TLS enforcement.',
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
                    <textarea
                      className={styles.prefixProxyTextarea}
                      rows={Math.max(3, editor.warnings.length + 1)}
                      readOnly
                      value={editor.warnings.join('\n')}
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
