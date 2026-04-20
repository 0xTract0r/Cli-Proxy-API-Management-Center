import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import type {
  PricingCatalogModel,
  PricingDetectedModel,
  PricingOverridePayload,
  PricingSourceSnapshot,
  UsagePricingSnapshot
} from '@/services/api/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface PriceSettingsCardProps {
  usageModelNames: string[];
  pricing: UsagePricingSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  onRefresh: () => Promise<void>;
  onSaveOverride: (model: string, payload: PricingOverridePayload) => Promise<void>;
  onDeleteOverride: (model: string) => Promise<void>;
}

interface PricingRow {
  observedModel: string;
  canonicalModel: string;
  displayName: string;
  pricingStatus: string;
  source: string;
  prices: PricingCatalogModel | null;
  override: PricingCatalogModel | null;
}

const formatTimestamp = (value?: string) => {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const formatPrice = (value?: number) => {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return `$${Number(value).toFixed(4)}/1M`;
};

const normalizePriceInput = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const resolveStatusTone = (status: string) => {
  switch (status) {
    case 'override':
      return styles.pricingBadgeOverride;
    case 'official':
      return styles.pricingBadgeOfficial;
    case 'unfinalized':
      return styles.pricingBadgePending;
    case 'unpriced':
      return styles.pricingBadgeMuted;
    default:
      return styles.pricingBadgeMuted;
  }
};

const resolveSourceLabel = (source?: string) => {
  if (!source) {
    return 'unknown';
  }
  return source;
};

const createEmptyForm = () => ({
  model: '',
  displayName: '',
  input: '',
  cachedInput: '',
  output: '',
  cacheWrite: ''
});

export function PriceSettingsCard({
  usageModelNames,
  pricing,
  loading,
  refreshing,
  error,
  onRefresh,
  onSaveOverride,
  onDeleteOverride
}: PriceSettingsCardProps) {
  const { t } = useTranslation();
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [form, setForm] = useState(createEmptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);

  const rows = useMemo<PricingRow[]>(() => {
    const detectedModels = Array.isArray(pricing?.detected_models) ? pricing?.detected_models : [];
    const detectedByObserved = new Map<string, PricingDetectedModel>();
    detectedModels.forEach((entry) => {
      const observed = entry.observed_model?.trim();
      if (observed) {
        detectedByObserved.set(observed, entry);
      }
    });

    const catalogModels = pricing?.models ?? {};
    const overrides = pricing?.overrides ?? {};
    const usageSet = new Set(usageModelNames.filter(Boolean));
    detectedByObserved.forEach((_, key) => usageSet.add(key));

    return Array.from(usageSet)
      .sort((left, right) => left.localeCompare(right))
      .map((observedModel) => {
        const detected = detectedByObserved.get(observedModel);
        const canonicalModel =
          detected?.canonical_model?.trim() || detected?.model?.trim() || observedModel;
        const override = overrides[observedModel] ?? overrides[canonicalModel] ?? null;
        const catalog = catalogModels[canonicalModel] ?? catalogModels[observedModel] ?? null;
        const prices = detected ?? override ?? catalog;
        const pricingStatus =
          detected?.pricing_status?.trim() ||
          (override ? 'override' : prices ? 'official' : 'unpriced');
        const source = resolveSourceLabel(detected?.source || override?.source || catalog?.source);

        return {
          observedModel,
          canonicalModel,
          displayName: prices?.display_name?.trim() || canonicalModel,
          pricingStatus,
          source,
          prices,
          override
        };
      });
  }, [pricing, usageModelNames]);

  const modelOptions = useMemo(
    () =>
      rows.map((row) => ({
        value: row.observedModel,
        label:
          row.observedModel === row.canonicalModel
            ? row.observedModel
            : `${row.observedModel} -> ${row.canonicalModel}`
      })),
    [rows]
  );

  const officialSources = Array.isArray(pricing?.official?.sources) ? pricing?.official?.sources : [];

  const openEditor = (row?: PricingRow) => {
    const targetModel = row?.observedModel || modelOptions[0]?.value || '';
    const targetRow = rows.find((entry) => entry.observedModel === targetModel);
    const seed = targetRow?.override ?? targetRow?.prices ?? null;
    setEditingModel(targetModel);
    setForm({
      model: targetModel,
      displayName: targetRow?.displayName || '',
      input: seed?.input_usd_per_mtok?.toString() ?? '',
      cachedInput:
        seed?.cached_input_usd_per_mtok !== undefined
          ? String(seed.cached_input_usd_per_mtok)
          : '',
      output: seed?.output_usd_per_mtok?.toString() ?? '',
      cacheWrite:
        seed?.cache_write_usd_per_mtok !== undefined ? String(seed.cache_write_usd_per_mtok) : ''
    });
  };

  const closeEditor = () => {
    setEditingModel(null);
    setForm(createEmptyForm());
    setSaving(false);
  };

  const handleModelChange = (model: string) => {
    const targetRow = rows.find((entry) => entry.observedModel === model);
    const seed = targetRow?.override ?? targetRow?.prices ?? null;
    setForm({
      model,
      displayName: targetRow?.displayName || '',
      input: seed?.input_usd_per_mtok?.toString() ?? '',
      cachedInput:
        seed?.cached_input_usd_per_mtok !== undefined
          ? String(seed.cached_input_usd_per_mtok)
          : '',
      output: seed?.output_usd_per_mtok?.toString() ?? '',
      cacheWrite:
        seed?.cache_write_usd_per_mtok !== undefined ? String(seed.cache_write_usd_per_mtok) : ''
    });
  };

  const handleSave = async () => {
    if (!form.model) {
      return;
    }
    setSaving(true);
    try {
      await onSaveOverride(form.model, {
        model: form.model,
        display_name: form.displayName || undefined,
        input_usd_per_mtok: normalizePriceInput(form.input),
        cached_input_usd_per_mtok: normalizePriceInput(form.cachedInput),
        output_usd_per_mtok: normalizePriceInput(form.output),
        cache_write_usd_per_mtok: normalizePriceInput(form.cacheWrite)
      });
      closeEditor();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (model: string) => {
    setDeletingModel(model);
    try {
      await onDeleteOverride(model);
    } finally {
      setDeletingModel(null);
    }
  };

  const renderPriceMeta = (model: PricingCatalogModel | null) => (
    <div className={styles.pricingValueGrid}>
      <div className={styles.pricingValueItem}>
        <span className={styles.pricingValueLabel}>{t('usage_stats.pricing_input_price')}</span>
        <strong>{formatPrice(model?.input_usd_per_mtok)}</strong>
      </div>
      <div className={styles.pricingValueItem}>
        <span className={styles.pricingValueLabel}>{t('usage_stats.pricing_cached_input_price')}</span>
        <strong>{formatPrice(model?.cached_input_usd_per_mtok)}</strong>
      </div>
      <div className={styles.pricingValueItem}>
        <span className={styles.pricingValueLabel}>{t('usage_stats.pricing_output_price')}</span>
        <strong>{formatPrice(model?.output_usd_per_mtok)}</strong>
      </div>
      <div className={styles.pricingValueItem}>
        <span className={styles.pricingValueLabel}>{t('usage_stats.pricing_cache_write_price')}</span>
        <strong>{formatPrice(model?.cache_write_usd_per_mtok)}</strong>
      </div>
    </div>
  );

  return (
    <Card
      title={t('usage_stats.model_price_settings')}
      extra={
        <div className={styles.pricingHeaderActions}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openEditor()}
            disabled={!modelOptions.length || loading}
          >
            {t('usage_stats.pricing_add_override')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onRefresh()}
            loading={refreshing}
            disabled={loading}
          >
            {t('usage_stats.pricing_refresh_official')}
          </Button>
        </div>
      }
    >
      <div className={styles.pricingSection}>
        <div className={styles.detailsNote}>{t('usage_stats.model_price_notice')}</div>

        {(error || !pricing) && !loading && (
          <div className={styles.errorBox}>
            {error || t('usage_stats.pricing_empty_state')}
          </div>
        )}

        <div className={styles.pricingSummaryGrid}>
          <div className={styles.pricingSummaryCard}>
            <div className={styles.pricingSummaryLabel}>{t('usage_stats.pricing_last_refreshed')}</div>
            <div className={styles.pricingSummaryValue}>
              {formatTimestamp(pricing?.official?.last_refreshed_at)}
            </div>
          </div>
          <div className={styles.pricingSummaryCard}>
            <div className={styles.pricingSummaryLabel}>{t('usage_stats.pricing_persisted_at')}</div>
            <div className={styles.pricingSummaryValue}>
              {formatTimestamp(pricing?.official?.persisted_at)}
            </div>
          </div>
          <div className={styles.pricingSummaryCard}>
            <div className={styles.pricingSummaryLabel}>{t('usage_stats.pricing_models_detected')}</div>
            <div className={styles.pricingSummaryValue}>{rows.length.toLocaleString()}</div>
          </div>
        </div>

        <div className={styles.pricingSourcesSection}>
          <div className={styles.pricingSectionTitle}>{t('usage_stats.pricing_official_sources')}</div>
          {officialSources.length ? (
            <div className={styles.pricingSourcesList}>
              {officialSources.map((source: PricingSourceSnapshot) => (
                <div key={source.id || source.label || source.url} className={styles.pricingSourceCard}>
                  <div className={styles.pricingSourceHeader}>
                    <div>
                      <div className={styles.pricingSourceTitle}>{source.label || source.id || '-'}</div>
                      {source.url && (
                        <a
                          className={styles.pricingSourceLink}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {source.url}
                        </a>
                      )}
                    </div>
                    <span className={`${styles.pricingBadge} ${resolveStatusTone(source.status || 'unpriced')}`}>
                      {source.status || '-'}
                    </span>
                  </div>
                  <div className={styles.pricingSourceMeta}>
                    <span>{t('usage_stats.pricing_source_models', { count: source.model_count ?? 0 })}</span>
                    <span>{formatTimestamp(source.last_refreshed_at)}</span>
                  </div>
                  {source.message && <div className={styles.pricingSourceMessage}>{source.message}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.hint}>{t('usage_stats.pricing_sources_empty')}</div>
          )}
        </div>

        <div className={styles.pricingUsageSection}>
          <div className={styles.pricingSectionTitle}>{t('usage_stats.pricing_effective_models')}</div>
          {rows.length ? (
            <div className={styles.pricingRows}>
              {rows.map((row) => (
                <div key={row.observedModel} className={styles.pricingRowCard}>
                  <div className={styles.pricingRowHeader}>
                    <div className={styles.pricingRowTitleBlock}>
                      <div className={styles.pricingRowTitle}>{row.observedModel}</div>
                      <div className={styles.pricingRowSubtitle}>
                        {t('usage_stats.pricing_canonical_model', { model: row.canonicalModel })}
                      </div>
                    </div>
                    <div className={styles.pricingRowBadges}>
                      <span className={`${styles.pricingBadge} ${resolveStatusTone(row.pricingStatus)}`}>
                        {row.pricingStatus}
                      </span>
                      <span className={`${styles.pricingBadge} ${styles.pricingBadgeNeutral}`}>
                        {row.source}
                      </span>
                    </div>
                  </div>

                  <div className={styles.pricingRowMeta}>
                    <span>{row.displayName}</span>
                    {row.override && (
                      <span className={styles.pricingOverrideNote}>
                        {t('usage_stats.pricing_override_active')}
                      </span>
                    )}
                  </div>

                  {renderPriceMeta(row.prices)}

                  <div className={styles.pricingRowActions}>
                    <Button variant="secondary" size="sm" onClick={() => openEditor(row)}>
                      {row.override
                        ? t('usage_stats.pricing_edit_override')
                        : t('usage_stats.pricing_set_override')}
                    </Button>
                    {row.override && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void handleDelete(row.observedModel)}
                        loading={deletingModel === row.observedModel}
                      >
                        {t('usage_stats.pricing_clear_override')}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.hint}>{t('usage_stats.pricing_models_empty')}</div>
          )}
        </div>
      </div>

      <Modal
        open={editingModel !== null}
        title={t('usage_stats.pricing_override_modal_title')}
        onClose={closeEditor}
        footer={
          <div className={styles.priceActions}>
            <Button variant="secondary" onClick={closeEditor}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        }
        width={520}
      >
        <div className={styles.editModalBody}>
          <div className={styles.formField}>
            <label>{t('usage_stats.model_name')}</label>
            <Select
              value={form.model}
              options={modelOptions}
              onChange={handleModelChange}
              placeholder={t('usage_stats.model_price_select_placeholder')}
            />
          </div>
          <Input
            label={t('usage_stats.pricing_display_name')}
            value={form.displayName}
            onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))}
            placeholder={t('usage_stats.pricing_display_name_placeholder')}
          />
          <Input
            label={`${t('usage_stats.pricing_input_price')} ($/1M)`}
            type="number"
            step="0.0001"
            value={form.input}
            onChange={(event) => setForm((prev) => ({ ...prev, input: event.target.value }))}
          />
          <Input
            label={`${t('usage_stats.pricing_cached_input_price')} ($/1M)`}
            type="number"
            step="0.0001"
            value={form.cachedInput}
            onChange={(event) => setForm((prev) => ({ ...prev, cachedInput: event.target.value }))}
          />
          <Input
            label={`${t('usage_stats.pricing_output_price')} ($/1M)`}
            type="number"
            step="0.0001"
            value={form.output}
            onChange={(event) => setForm((prev) => ({ ...prev, output: event.target.value }))}
          />
          <Input
            label={`${t('usage_stats.pricing_cache_write_price')} ($/1M)`}
            type="number"
            step="0.0001"
            value={form.cacheWrite}
            onChange={(event) => setForm((prev) => ({ ...prev, cacheWrite: event.target.value }))}
          />
        </div>
      </Modal>
    </Card>
  );
}
