export const PREVIEW_SAMPLE_USAGE_STORAGE_KEY = 'cli-proxy-preview-sample-usage-v1';

type UsageDetailSeed = {
  timestamp: string;
  source: string;
  auth_index: number;
  latency_ms: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  failed?: boolean;
  cost_usd: number;
};

type UsageDetailRecord = {
  timestamp: string;
  source: string;
  auth_index: number;
  latency_ms: number;
  cost_usd: number;
  pricing_status: string;
  tokens: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    cached_tokens: number;
    cache_read_input_tokens: number;
    cache_write_input_tokens: number;
    total_tokens: number;
  };
  failed: boolean;
};

type UsageModelEntry = {
  total_requests: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  total_cost_usd: number;
  details: UsageDetailRecord[];
};

type UsageApiEntry = {
  total_requests: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  total_cost_usd: number;
  models: Record<string, UsageModelEntry>;
};

const minuteAgo = (nowMs: number, minutes: number) =>
  new Date(nowMs - minutes * 60 * 1000).toISOString();

const createDetail = (seed: UsageDetailSeed): UsageDetailRecord => {
  const totalTokens =
    seed.inputTokens +
    seed.outputTokens +
    seed.reasoningTokens +
    seed.cacheReadTokens +
    seed.cacheWriteTokens;

  return {
    timestamp: seed.timestamp,
    source: seed.source,
    auth_index: seed.auth_index,
    latency_ms: seed.latency_ms,
    cost_usd: seed.cost_usd,
    pricing_status: 'estimated',
    failed: seed.failed === true,
    tokens: {
      input_tokens: seed.inputTokens,
      output_tokens: seed.outputTokens,
      reasoning_tokens: seed.reasoningTokens,
      cached_tokens: seed.cacheReadTokens,
      cache_read_input_tokens: seed.cacheReadTokens,
      cache_write_input_tokens: seed.cacheWriteTokens,
      total_tokens: totalTokens,
    },
  };
};

const sumModelEntries = (models: Record<string, UsageModelEntry>) =>
  Object.values(models).reduce(
    (total, model) => ({
      requests: total.requests + model.total_requests,
      success: total.success + model.success_count,
      failure: total.failure + model.failure_count,
      tokens: total.tokens + model.total_tokens,
      cost: total.cost + model.total_cost_usd,
    }),
    { requests: 0, success: 0, failure: 0, tokens: 0, cost: 0 }
  );

const createModelEntry = (details: UsageDetailRecord[]): UsageModelEntry => {
  const failureCount = details.filter((detail) => detail.failed).length;
  const totalTokens = details.reduce((sum, detail) => sum + detail.tokens.total_tokens, 0);
  const totalCost = details.reduce((sum, detail) => sum + detail.cost_usd, 0);

  return {
    total_requests: details.length,
    success_count: details.length - failureCount,
    failure_count: failureCount,
    total_tokens: totalTokens,
    total_cost_usd: totalCost,
    details,
  };
};

const createApiEntry = (models: Record<string, UsageModelEntry>): UsageApiEntry => {
  const summary = sumModelEntries(models);
  return {
    total_requests: summary.requests,
    success_count: summary.success,
    failure_count: summary.failure,
    total_tokens: summary.tokens,
    total_cost_usd: summary.cost,
    models,
  };
};

export function createPreviewSampleUsage(nowMs: number = Date.now()): Record<string, unknown> {
  const codexModels = {
    'gpt-5.5': createModelEntry([
      createDetail({
        timestamp: minuteAgo(nowMs, 5),
        source: 'preview-codex',
        auth_index: 0,
        latency_ms: 1120,
        inputTokens: 1600,
        outputTokens: 520,
        reasoningTokens: 180,
        cacheReadTokens: 18500,
        cacheWriteTokens: 0,
        cost_usd: 0.037,
      }),
      createDetail({
        timestamp: minuteAgo(nowMs, 18),
        source: 'preview-codex',
        auth_index: 0,
        latency_ms: 1540,
        inputTokens: 2200,
        outputTokens: 760,
        reasoningTokens: 260,
        cacheReadTokens: 31200,
        cacheWriteTokens: 900,
        cost_usd: 0.058,
      }),
      createDetail({
        timestamp: minuteAgo(nowMs, 43),
        source: 'preview-codex',
        auth_index: 0,
        latency_ms: 1310,
        inputTokens: 1800,
        outputTokens: 610,
        reasoningTokens: 120,
        cacheReadTokens: 22600,
        cacheWriteTokens: 0,
        cost_usd: 0.044,
      }),
      createDetail({
        timestamp: minuteAgo(nowMs, 96),
        source: 'preview-codex',
        auth_index: 0,
        latency_ms: 1780,
        inputTokens: 2600,
        outputTokens: 980,
        reasoningTokens: 340,
        cacheReadTokens: 0,
        cacheWriteTokens: 6800,
        cost_usd: 0.091,
      }),
    ]),
    'gpt-5.2': createModelEntry([
      createDetail({
        timestamp: minuteAgo(nowMs, 12),
        source: 'preview-codex',
        auth_index: 1,
        latency_ms: 2480,
        inputTokens: 3500,
        outputTokens: 820,
        reasoningTokens: 410,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost_usd: 0.029,
      }),
      createDetail({
        timestamp: minuteAgo(nowMs, 142),
        source: 'preview-codex',
        auth_index: 1,
        latency_ms: 3100,
        inputTokens: 4200,
        outputTokens: 640,
        reasoningTokens: 360,
        cacheReadTokens: 0,
        cacheWriteTokens: 1200,
        failed: true,
        cost_usd: 0.021,
      }),
    ]),
  };

  const claudeModels = {
    'claude-sonnet-4.5': createModelEntry([
      createDetail({
        timestamp: minuteAgo(nowMs, 31),
        source: 'preview-claude',
        auth_index: 0,
        latency_ms: 1860,
        inputTokens: 2100,
        outputTokens: 700,
        reasoningTokens: 0,
        cacheReadTokens: 8400,
        cacheWriteTokens: 0,
        cost_usd: 0.033,
      }),
    ]),
  };

  const apis = {
    'POST /backend-api/codex/responses': createApiEntry(codexModels),
    'POST /v1/messages': createApiEntry(claudeModels),
  };
  const summary = sumModelEntries(
    Object.values(apis).reduce<Record<string, UsageModelEntry>>((models, api) => {
      Object.entries(api.models).forEach(([name, model]) => {
        models[`${name}:${Object.keys(models).length}`] = model;
      });
      return models;
    }, {})
  );

  return {
    __preview_sample: true,
    generated_at: new Date(nowMs).toISOString(),
    total_requests: summary.requests,
    success_count: summary.success,
    failure_count: summary.failure,
    total_tokens: summary.tokens,
    total_cost_usd: summary.cost,
    apis,
  };
}

export function isPreviewSampleUsageEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return false;
    }
    return localStorage.getItem(PREVIEW_SAMPLE_USAGE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isPreviewSampleUsage(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).__preview_sample === true
  );
}
