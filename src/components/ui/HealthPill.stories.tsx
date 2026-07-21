// @ts-nocheck
// 占位 Storybook story（telemetry-farm-observability P0-7）：本仓库当前未接入
// Storybook（apps/web 无 @storybook/* devDependency、无 .storybook 配置），
// `@storybook/react` 模块目前无法解析。`@ts-nocheck` 只是为了不让这个占位
// 文件在没装依赖前拖垮 `tsc`/`npm run build`（tsconfig `include: ["src"]`
// 会把它一并类型检查）；接入 Storybook 后请删掉这行。
// 这个文件不会被任何脚本构建/渲染，只作为 P0-8 接入状态栏双列前的可视化
// 验收骨架——接入 Storybook 时可直接使用，不需要重新设计用例矩阵。
import type { Meta, StoryObj } from '@storybook/react';
import { HealthPill } from './HealthPill';

const meta: Meta<typeof HealthPill> = {
  title: 'UI/HealthPill',
  component: HealthPill,
  parameters: {
    // design.md 决策6：语义色随浅色/纯白/深色三套主题（--health-ok/warn/err/idle）
    // 自动切换，评审时需要在三套 data-theme 下分别截图核对对比度。
  },
};
export default meta;

type Story = StoryObj<typeof HealthPill>;

export const Ok: Story = {
  args: { status: 'ok', label: '运行中', dimension: '容器健康' },
};

export const Warn: Story = {
  args: {
    status: 'warn',
    label: '降级',
    dimension: '容器健康',
    reason: '账号有真实 LLM 流量，但容器遥测/保活信号缺失（可能是遥测侧问题，非账号故障）',
  },
};

export const Err: Story = {
  args: {
    status: 'err',
    label: '离线',
    dimension: '容器健康',
    reason: '连续 3 次心跳超时',
  },
};

export const Idle: Story = {
  args: { status: 'idle', label: '未绑定', dimension: '账号健康' },
};

/** 四态并排，用于视觉回归对比同一截图内的色阶区分度。 */
export const AllStatuses: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12 }}>
      <HealthPill status="ok" label="运行中" dimension="容器健康" />
      <HealthPill status="warn" label="降级" dimension="容器健康" />
      <HealthPill status="err" label="离线" dimension="容器健康" />
      <HealthPill status="idle" label="未绑定" dimension="账号健康" />
    </div>
  ),
};
