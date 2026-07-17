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

/** 数值水位直接映射到既有 status-badge className，桥接旧调用点（不改变视觉输出）。 */
export function pctToFarmHealthBadgeVariant(pct: number | undefined): StatusBadgeVariant {
  return farmHealthVariantToBadgeVariant(pctToFarmHealthVariant(pct));
}
