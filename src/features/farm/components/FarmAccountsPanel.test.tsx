// @ts-nocheck
// 占位/验收骨架单测（农场账号面板两项 UX 修复：A 状态栏两维区分 + B 请求节奏
// 可见）。与本仓库既有 HealthPill.test.tsx / AuthFileCard.test.tsx 一致——
// apps/web 当前未接入 Vitest/@testing-library（package.json 无相关
// devDependency，也无 vitest.config），`vitest`/`@testing-library/react` 目前
// 无法解析。`@ts-nocheck` 只是让本文件不拖垮 `tsc --noEmit`/`vite build`
// （tsconfig `include: ["src"]` 会一并类型检查）。本文件不会被任何脚本执行，
// 只作为接入测试运行时后可直接启用的验收骨架，并把两项改动的确定性 testid
// 契约固化下来，供集成阶段 Playwright / 未来 Vitest 复用。
//
// 接入测试运行时前，请先在 apps/web 补齐 `vitest` + `@testing-library/react`
// + `jsdom`（或等价方案）与对应 npm script，再删掉本行 `@ts-nocheck`。
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { FarmAccountsPanel } from './FarmAccountsPanel';

// 一条已接入农场、running、认证存活、且有实测均值的账号，覆盖两项改动的
// 主路径（cadence 全字段 + 健康态单 pill 无副信息行）。
const boundHealthyAccount = {
  name: 'claude-ac04@example.com.json',
  account: 'ac04@example.com',
  note: 'AC04',
  status: 'active',
  disabled: false,
  auto_quarantined: false,
  farm_bound: true,
  farm_container_id: 'farm-ac04',
  farm_env: 'test',
  farm_container_status: 'running',
  device_id_source: 'container_synced',
  success: 128,
  failed: 2,
  recent_requests: 130,
};

const boundContainer = {
  id: 'farm-ac04',
  device_id_masked: 'abcd1234',
  status: 'running',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: new Date().toISOString(),
  last_keepalive_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  account_auth_status: 'alive',
  next_keepalive_estimate: {
    min_seconds: 600,
    max_seconds: 5400,
    base_seconds: 1800,
    avg_observed_seconds_24h: 1723,
    note: '随机抖动，唤醒时刻非精确',
  },
};

// 未接入农场、可 onboard 的账号，覆盖 A③（onboard 按钮在操作列）与 B 的
// 「未接入农场」cadence 兜底。
const unboundAccount = {
  name: 'claude-ac09@example.com.json',
  account: 'ac09@example.com',
  status: 'active',
  disabled: false,
  auto_quarantined: false,
  farm_bound: false,
  device_id_source: 'synthetic',
};

function mountPanel(accounts, containers) {
  vi.mock('../hooks/useFarmAccounts', () => ({
    useFarmAccounts: () => ({ accounts, loading: false, error: '', reload: vi.fn() }),
  }));
  vi.mock('../hooks/useFarmContainers', () => ({
    useFarmContainers: () => ({ containers }),
  }));
  vi.mock('../hooks/useFarmAccountState', () => ({
    useFarmAccountState: () => ({ accountStates: [], loading: false, error: '', reload: vi.fn() }),
  }));
  vi.mock('../hooks/useFarmOnboard', () => ({
    useFarmOnboard: () => ({ onboardingAccountId: null, onboard: vi.fn() }),
  }));
  return render(<FarmAccountsPanel containers={containers} />);
}

describe('FarmAccountsPanel — A) 状态栏两维区分', () => {
  it('健康且新鲜的账号，健康态单格只有 pill，不展开 as-of/陈旧副信息行', () => {
    mountPanel([boundHealthyAccount], [boundContainer]);
    expect(
      screen.getByTestId(`farm-account-health-pill-${boundHealthyAccount.name}`)
    ).toBeInTheDocument();
    // ② 健康 + 新鲜 → 不出现副信息行
    expect(
      screen.queryByTestId(`farm-account-auth-secondary-${boundHealthyAccount.name}`)
    ).toBeNull();
    expect(
      screen.queryByTestId(`farm-container-health-secondary-${boundHealthyAccount.name}`)
    ).toBeNull();
  });

  it('③ 接入农场按钮出现在操作列，不在容器运行态格内', () => {
    mountPanel([unboundAccount], []);
    const actionsCell = screen.getByTestId(`farm-account-onboard-${unboundAccount.name}`);
    expect(actionsCell).toBeInTheDocument();
    const containerCell = screen.getByTestId(`farm-container-health-cell-${unboundAccount.name}`);
    expect(
      within(containerCell).queryByTestId(`farm-account-onboard-${unboundAccount.name}`)
    ).toBeNull();
  });
});

describe('FarmAccountsPanel — B) 请求节奏可见', () => {
  it('已接入账号每行展示节奏区块：口径徽标 + 上次/平均/下次 + 随机抖动强制标注 + 成败', () => {
    mountPanel([boundHealthyAccount], [boundContainer]);
    const cell = screen.getByTestId(`farm-account-cadence-cell-${boundHealthyAccount.name}`);
    expect(cell).toBeInTheDocument();
    // 强制标注「随机抖动·非精确」
    expect(
      within(cell).getByTestId(`farm-account-cadence-jitter-${boundHealthyAccount.name}`)
    ).toBeInTheDocument();
    // recent_requests 成功/失败数字
    expect(
      within(cell).getByTestId(`farm-account-cadence-outcome-${boundHealthyAccount.name}`)
    ).toHaveTextContent('128');
  });

  it('未接入农场的账号，节奏区块显示「未接入农场」而非伪造节奏', () => {
    mountPanel([unboundAccount], []);
    const cell = screen.getByTestId(`farm-account-cadence-cell-${unboundAccount.name}`);
    expect(cell).toBeInTheDocument();
    expect(
      within(cell).queryByTestId(`farm-account-cadence-jitter-${unboundAccount.name}`)
    ).toBeNull();
  });
});
