// @ts-nocheck
// 占位单测（telemetry-farm-observability P0-7）：本仓库当前未接入
// Vitest/@testing-library/react（apps/web/package.json 无相关 devDependency，
// 也无 vitest.config），`vitest`/`@testing-library/react` 模块目前无法解析。
// `@ts-nocheck` 只是为了不让这个占位文件在没装依赖前拖垮 `tsc`/`npm run build`
// （tsconfig `include: ["src"]` 会把它一并类型检查，即便没有任何真实代码
// import 它）；一旦接入测试运行时，请删掉这行并让类型检查正常生效。
// 这个文件本身不会被任何脚本执行，只作为 P0-8 接入状态栏双列时的验收骨架。
// 接入测试运行时前，请先在 apps/web 补齐 `vitest` + `@testing-library/react` +
// `jsdom`（或等价方案）与对应 npm script，再把本文件纳入 CI。
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthPill } from './HealthPill';

describe('HealthPill', () => {
  it('renders the visible label and exposes a semantic status attribute', () => {
    render(<HealthPill status="ok" label="运行中" data-testid="pill-basic" />);
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.getByTestId('pill-basic')).toHaveAttribute('data-status', 'ok');
  });

  it.each([
    ['ok', 'success'],
    ['warn', 'warning'],
    ['err', 'error'],
    ['idle', 'muted'],
  ] as const)('maps status=%s to a distinct icon+color class (%s tier)', (status) => {
    render(<HealthPill status={status} label="label" data-testid={`pill-${status}`} />);
    const el = screen.getByTestId(`pill-${status}`);
    expect(el.getAttribute('data-status')).toBe(status);
    // 四态各自的语义色类名互斥（同一时刻只挂一个 status 修饰类）。
    expect(el.className).toContain(status);
  });

  it('folds the dimension into aria-label instead of visible text (icon is the dimension identity)', () => {
    render(<HealthPill status="warn" label="降级" dimension="容器健康" data-testid="pill-dim" />);
    const el = screen.getByTestId('pill-dim');
    expect(el).toHaveAttribute('aria-label', '容器健康: 降级');
    // 可见文案只有 label，不重复维度前缀（design.md 决策6："图标即维度标识"）。
    expect(el.textContent).toBe('降级');
  });

  it('surfaces reason via a native title attribute (tooltip placeholder, no dedicated Tooltip component yet)', () => {
    render(
      <HealthPill status="err" label="离线" reason="连续 3 次心跳超时" data-testid="pill-reason" />
    );
    expect(screen.getByTestId('pill-reason')).toHaveAttribute('title', '连续 3 次心跳超时');
  });

  it('omits title when no reason is given', () => {
    render(<HealthPill status="idle" label="—" data-testid="pill-no-reason" />);
    expect(screen.getByTestId('pill-no-reason')).not.toHaveAttribute('title');
  });
});
