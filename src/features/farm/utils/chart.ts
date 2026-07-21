/**
 * 轻量内联 SVG 图表几何计算（telemetry-farm-observability P0-9「容器详情
 * 抽屉」：心跳 sparkline+latency、资源 area 图）。design.md 决策6明确「可用
 * 轻量内联 SVG/现有图表能力,不引重型图表库」——这里只做纯几何映射（数值 →
 * 坐标点/路径字符串），渲染仍由调用方 <svg><polyline>/<path> 完成，不引入
 * d3/recharts/victory 等依赖。
 */

export interface ChartPoint {
  x: number;
  y: number;
}

/**
 * 把一组数值（可能含 null/undefined 空洞——分桶时序里没有样本的桶）映射到
 * [0, width] x [0, height] 的坐标点。空洞不产出坐标点（调用方据此拆段，避免
 * 用直线连接两个本不相邻的真实样本，假装中间也有数据）。
 *
 * min/max 显式传入时用固定量程（如百分比 0~100 使用 [0,100]，跨多组图表
 * 视觉可比）；不传时按当前序列自适应（至少留一点边距，避免全等值时压成一条
 * 线看不出变化）。
 */
export function mapSeriesToPoints(
  values: Array<number | null | undefined>,
  width: number,
  height: number,
  options?: { padding?: number; min?: number; max?: number }
): Array<ChartPoint | null> {
  const padding = options?.padding ?? 2;
  const finiteValues = values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v)
  );
  if (finiteValues.length === 0 || values.length === 0) return values.map(() => null);

  let min = options?.min ?? Math.min(...finiteValues);
  let max = options?.max ?? Math.max(...finiteValues);
  if (max - min < 1e-9) {
    // 全部同值：撑开一个人为量程，避免除零把所有点压到同一行。
    min -= 1;
    max += 1;
  }

  const innerWidth = Math.max(width - padding * 2, 1);
  const innerHeight = Math.max(height - padding * 2, 1);
  const stepX = values.length > 1 ? innerWidth / (values.length - 1) : 0;

  return values.map((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const x = padding + i * stepX;
    const clamped = Math.min(Math.max(v, min), max);
    const y = padding + innerHeight - ((clamped - min) / (max - min)) * innerHeight;
    return { x, y };
  });
}

/** 把坐标点数组按空洞拆成若干条连续折线段，供多个 <polyline> 分别渲染。 */
export function splitIntoSegments(points: Array<ChartPoint | null>): ChartPoint[][] {
  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  for (const p of points) {
    if (p === null) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push(p);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** 折线段 → SVG polyline points 属性字符串。 */
export function segmentToPolylinePoints(segment: ChartPoint[]): string {
  return segment.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

/**
 * 折线段 → 闭合到基线（height - padding）的 area 填充路径（SVG path `d`），
 * 供 <path fill="..."> 渲染面积图。单点段（无法连线）返回空串，调用方应
 * 跳过渲染而非画退化图形。
 */
export function segmentToAreaPath(segment: ChartPoint[], height: number, padding = 2): string {
  if (segment.length < 2) return '';
  const baseline = height - padding;
  const line = segment.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const first = segment[0];
  const last = segment[segment.length - 1];
  return `${line} L${last.x.toFixed(2)},${baseline.toFixed(2)} L${first.x.toFixed(2)},${baseline.toFixed(2)} Z`;
}
