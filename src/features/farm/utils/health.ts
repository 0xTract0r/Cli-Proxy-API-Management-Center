/**
 * 农场健康语义色 + 阈值单一真源（telemetry-farm-observability P0-7 决策6
 * 「前端基建」）。此前 90/70 阈值只在 FarmResourcePanel.pctVariant 本地硬编码
 * 一处；这里收敛成共享常量，供 <HealthPill>（P0-8 起接入）与既有
 * status-badge 着色路径（FarmResourcePanel 资源水位）共用同一套判定，避免
 * 未来新增面板各自重定义一份阈值导致口径漂移。
 *
 * 语义色本身（--health-ok/warn/err/idle）已提升为 themes.scss CSS 自定义
 * 属性，供 <HealthPill> 直接消费；此文件只承载"数值 -> 四态"的判定逻辑与
 * 到既有 status-badge className（success/warning/error/muted）的桥接，避免
 * CSS token 里再重复放运行时用不上的纯数字阈值。
 */

/** 与 --health-ok/warn/err/idle 一一对应的健康四态。 */
export type FarmHealthVariant = 'ok' | 'warn' | 'err' | 'idle';

/** 资源水位分级阈值：>=90% 视为紧急（err），>=70% 视为需要关注（warn）。 */
export const FARM_HEALTH_PCT_ERR_THRESHOLD = 90;
export const FARM_HEALTH_PCT_WARN_THRESHOLD = 70;

/** 数值型水位（如 CPU/内存百分比）按阈值映射到健康四态。 */
export function pctToFarmHealthVariant(pct: number | undefined): FarmHealthVariant {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 'idle';
  if (pct >= FARM_HEALTH_PCT_ERR_THRESHOLD) return 'err';
  if (pct >= FARM_HEALTH_PCT_WARN_THRESHOLD) return 'warn';
  return 'ok';
}

/**
 * 24h keepalive 成功率阈值（P0-9 表格增强列）。与资源水位阈值方向相反——
 * 成功率越高越好，不能直接复用 pctToFarmHealthVariant（那是「越高越差」的
 * 资源占用语义）。>=95% 健康、>=80% 需要关注、否则紧急；无样本回退 idle
 * （既不是"健康"也不是"故障"，是"没数据"）。
 */
export const FARM_SUCCESS_RATE_ERR_THRESHOLD = 0.8;
export const FARM_SUCCESS_RATE_WARN_THRESHOLD = 0.95;

export function successRateToFarmHealthVariant(rate: number | undefined): FarmHealthVariant {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return 'idle';
  if (rate < FARM_SUCCESS_RATE_ERR_THRESHOLD) return 'err';
  if (rate < FARM_SUCCESS_RATE_WARN_THRESHOLD) return 'warn';
  return 'ok';
}

/**
 * health_reason 字面值 → 健康四态（供 <HealthPill> 消费，design.md 决策4
 * 「P0-1 假降级修复：health_reason 明示」）。字面值来源见
 * services/farm-orchestrator/internal/httpapi/observability.go
 * computeHealthReason/knownFiringReasonsPriority 与 containerView.Status 本身
 * （某些 reason 探测不到时诚实回退到 status 字面值，见该文件注释）。
 *
 * - ok：健康。
 * - keepalive_stale_ok：P0-1 附带发现——最近保活全成功但已超过
 *   MaxKeepaliveInterval，是「陈旧但仍健康」的软信号，故意映射 warn 而非
 *   ok/err，提醒 operator 关注但不误判为故障。
 * - keepalive_recent_failures / keepalive_stale / no_keepalive_data：
 *   degraded 的具体成因，映射 warn（已经在 degraded 状态列本身标了警示色，
 *   这里是"为什么"而非"多严重"）。
 * - container_exited_or_missing：down 的成因，映射 err。
 * - not_started / container_transient_state / retired /
 *   docker_missing_orphaned：非故障的生命周期占位态，映射 idle。
 * - 其余未知值（含 computeHealthReason 探测不到时回退的 status 字面值，如
 *   直接是 'degraded'/'down'）按字面值本身兜底判断，避免整列失去信号。
 */
const HEALTH_REASON_VARIANT: Record<string, FarmHealthVariant> = {
  ok: 'ok',
  keepalive_stale_ok: 'warn',
  keepalive_recent_failures: 'warn',
  keepalive_stale: 'warn',
  no_keepalive_data: 'warn',
  container_exited_or_missing: 'err',
  not_started: 'idle',
  container_transient_state: 'idle',
  retired: 'idle',
  docker_missing_orphaned: 'idle',
};

/**
 * device_id 对齐（容器→账号方向：container_synced/drift/unknown，见
 * types/farm.ts FarmContainerView.device_id_alignment 注释）→ status-badge
 * className。供 FarmContainerTable（表格列）与 FarmContainerDetail（详情卡）
 * 共用同一份映射，不各自重复内联三元表达式。
 */
const DEVICE_ALIGNMENT_BADGE_VARIANT: Record<string, StatusBadgeVariant> = {
  container_synced: 'success',
  drift: 'warning',
  unknown: 'muted',
};

export function deviceAlignmentToBadgeVariant(alignment: string | undefined): StatusBadgeVariant {
  if (!alignment) return 'muted';
  return DEVICE_ALIGNMENT_BADGE_VARIANT[alignment] ?? 'muted';
}

export function healthReasonToFarmHealthVariant(reason: string | undefined): FarmHealthVariant {
  if (!reason) return 'idle';
  if (reason in HEALTH_REASON_VARIANT) return HEALTH_REASON_VARIANT[reason];
  // 回退：探测不到具体 reason 时 computeHealthReason 会直接给 status 字面值
  // （如 'degraded'/'down'），status 本身也可能被当作 reason 传进来。
  if (reason === 'down') return 'err';
  if (reason === 'degraded' || reason === 'orphaned') return 'warn';
  return 'idle';
}

/** 既有 status-badge 全局样式只认 success/warning/error/muted 四个 className。 */
export type StatusBadgeVariant = 'success' | 'warning' | 'error' | 'muted';

const HEALTH_TO_BADGE_VARIANT: Record<FarmHealthVariant, StatusBadgeVariant> = {
  ok: 'success',
  warn: 'warning',
  err: 'error',
  idle: 'muted',
};

export function farmHealthVariantToBadgeVariant(variant: FarmHealthVariant): StatusBadgeVariant {
  return HEALTH_TO_BADGE_VARIANT[variant];
}

// 注：FarmHealthVariant 与 <HealthPill> 的 HealthPillStatus 字面量集合逐字相同
// （'ok'|'warn'|'err'|'idle'），FarmContainerTable/FarmContainerDetail（P0-9）
// 可以直接把 FarmHealthVariant 值传给 HealthPill 的 status prop，不需要额外的
// 类型断言或桥接函数。

/** 数值水位直接映射到既有 status-badge className，桥接旧调用点（不改变视觉输出）。 */
export function pctToFarmHealthBadgeVariant(pct: number | undefined): StatusBadgeVariant {
  return farmHealthVariantToBadgeVariant(pctToFarmHealthVariant(pct));
}
