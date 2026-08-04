// @ts-nocheck
// 骨架/验收单测（用户⑤「每容器遥测内容抓取」前端遥测面板）。与本仓库既有
// FarmAccountsPanel.test.tsx / HealthPill.test.tsx 一致——apps/web 当前未接入
// Vitest/@testing-library（package.json 无相关 devDependency，也无 vitest.config），
// `vitest`/`@testing-library/react` 目前无法解析。`@ts-nocheck` 只是让本文件不拖垮
// `tsc --noEmit`/`vite build`（tsconfig `include: ["src"]` 会一并类型检查）。
// 本文件不会被任何脚本执行，只作为接入测试运行时后可直接启用的验收骨架，把遥测
// 面板的确定性 testid 契约与「on-wire 待抓取」诚实边界固化下来，供集成阶段
// Playwright / 未来 Vitest 复用。
//
// 接入测试运行时前，请先在 apps/web 补齐 `vitest` + `@testing-library/react`
// + `jsdom`（或等价方案）与对应 npm script，再删掉本行 `@ts-nocheck`。
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { FarmTelemetryPanel } from './FarmTelemetryPanel';
import {
  FARM_TELEMETRY_ALERT_REASONS,
  FARM_TELEMETRY_FINGERPRINT_FIELDS,
  isFarmTelemetryAlertReason,
} from '@/types/farm';

const container = {
  id: 'farm-ac04',
  device_id_masked: 'abcd1234',
  status: 'running',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-04T03:00:00Z',
};

// 两条自报 beacon，captured_at 降序（后端契约），覆盖多通道 + 多 source。
const beacons = [
  {
    captured_at: new Date().toISOString(),
    channel: 'claude-cli',
    host: 'api.anthropic.com',
    path: '/v1/messages',
    body_bytes: 512,
    device_id: 'dev-AAAA-full-not-masked',
    api_base_url_host: 'api.anthropic.com',
    entrypoint: 'cli',
    source: 'declared',
  },
  {
    captured_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    channel: 'codex',
    host: 'chatgpt.com',
    path: '/backend-api/conversation',
    body_bytes: 128,
    device_id: 'dev-AAAA-full-not-masked',
    api_base_url_host: 'chatgpt.com',
    entrypoint: 'cli',
    source: 'self-report',
  },
];

function mountPanel(bcns) {
  vi.mock('../hooks/useFarmContainerBeacons', () => ({
    useFarmContainerBeacons: () => ({ beacons: bcns, loading: false, error: '', reload: vi.fn() }),
    FARM_CONTAINER_BEACONS_DEFAULT_LIMIT: 50,
  }));
  return render(<FarmTelemetryPanel container={container} />);
}

describe('FarmTelemetryPanel — 诚实边界（on-wire 待抓取）', () => {
  it('始终显示免责声明，且三个指纹字段的 on-wire 列都灰置标注「待抓取」，data-pending=true', () => {
    mountPanel(beacons);
    expect(screen.getByTestId('farm-telemetry-disclaimer')).toBeInTheDocument();
    for (const field of FARM_TELEMETRY_FINGERPRINT_FIELDS) {
      const onWire = screen.getByTestId(`farm-telemetry-onwire-${field}`);
      expect(onWire).toHaveAttribute('data-pending', 'true');
      // on-wire 恒为空 → 撞红逻辑休眠，行 data-clash 恒 false（永不误红）。
      const row = screen.getByTestId(`farm-telemetry-consistency-row-${field}`);
      expect(row).toHaveAttribute('data-clash', 'false');
    }
  });

  it('declared 列用最新一条 beacon 的自报值填充（device_id 全量、非脱敏）', () => {
    mountPanel(beacons);
    const declaredDevId = screen.getByTestId('farm-telemetry-declared-device_id');
    expect(declaredDevId).toHaveTextContent('dev-AAAA-full-not-masked');
    expect(screen.getByTestId('farm-telemetry-declared-api_base_url_host')).toHaveTextContent(
      'api.anthropic.com'
    );
  });

  it('空 beacon 时仍保留免责声明与 on-wire 待抓取边界，时间线走空态而非整卡消失', () => {
    mountPanel([]);
    expect(screen.getByTestId('farm-telemetry-disclaimer')).toBeInTheDocument();
    expect(screen.getByTestId('farm-telemetry-onwire-device_id')).toHaveAttribute(
      'data-pending',
      'true'
    );
    expect(screen.getByTestId('farm-telemetry-timeline-empty')).toBeInTheDocument();
    // declared 空 → 占位「—」，不伪造值。
    expect(screen.getByTestId('farm-telemetry-declared-entrypoint')).toHaveTextContent('—');
  });
});

describe('FarmTelemetryPanel — 时间线 / 通道分布 / 新鲜度', () => {
  it('通道分布按 channel 归并出 chip，时间线逐条渲染', () => {
    mountPanel(beacons);
    expect(screen.getByTestId('farm-telemetry-channel-claude-cli')).toBeInTheDocument();
    expect(screen.getByTestId('farm-telemetry-channel-codex')).toBeInTheDocument();
    const timeline = screen.getByTestId('farm-telemetry-timeline');
    expect(within(timeline).getByTestId('farm-telemetry-beacon-0')).toBeInTheDocument();
    expect(within(timeline).getByTestId('farm-telemetry-beacon-1')).toBeInTheDocument();
  });

  it('最新 beacon 在近端时新鲜度标记非陈旧（data-stale=false）', () => {
    mountPanel(beacons);
    expect(screen.getByTestId('farm-telemetry-freshness')).toHaveAttribute('data-stale', 'false');
  });
});

// 纯逻辑单测（不依赖 testing-library，接入 vitest 即可真跑）：遥测告警 reason
// 分类判定。
describe('isFarmTelemetryAlertReason', () => {
  it('识别全部 5 个遥测自洽 reason 码', () => {
    for (const reason of FARM_TELEMETRY_ALERT_REASONS) {
      expect(isFarmTelemetryAlertReason(reason)).toBe(true);
    }
  });

  it('容器运行态 reason / 空值不误判为遥测类', () => {
    expect(isFarmTelemetryAlertReason('keepalive_stale')).toBe(false);
    expect(isFarmTelemetryAlertReason('ok')).toBe(false);
    expect(isFarmTelemetryAlertReason(undefined)).toBe(false);
    expect(isFarmTelemetryAlertReason('')).toBe(false);
  });
});
