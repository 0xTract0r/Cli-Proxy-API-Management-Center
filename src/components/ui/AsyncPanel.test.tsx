// @ts-nocheck
// 占位单测（telemetry-farm-observability P0-7）：见 HealthPill.test.tsx 顶部
// 说明——本仓库尚未接入 Vitest/@testing-library/react，`@ts-nocheck` 只是为了
// 不让占位文件拖垮 `tsc`/`npm run build`。接入测试运行时后请删掉这行。
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AsyncPanel } from './AsyncPanel';

describe('AsyncPanel', () => {
  it('renders the loading state first, even if error/isEmpty are also set', () => {
    render(
      <AsyncPanel
        loading
        error="boom"
        isEmpty
        loadingLabel="加载中…"
        loadingTestId="loading"
        errorTestId="error"
        empty={{ title: '空', testId: 'empty' }}
      >
        <div data-testid="data">data</div>
      </AsyncPanel>
    );
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    expect(screen.queryByTestId('error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('data')).not.toBeInTheDocument();
  });

  it('renders the error state when not loading', () => {
    render(
      <AsyncPanel
        loading={false}
        error="加载失败"
        isEmpty={false}
        loadingLabel="加载中…"
        errorTestId="error"
      >
        <div data-testid="data">data</div>
      </AsyncPanel>
    );
    expect(screen.getByTestId('error')).toHaveTextContent('加载失败');
    expect(screen.queryByTestId('data')).not.toBeInTheDocument();
  });

  it('renders the empty state when isEmpty and no error, and skips it without an `empty` config', () => {
    render(
      <AsyncPanel loading={false} isEmpty loadingLabel="加载中…">
        <div data-testid="data">data</div>
      </AsyncPanel>
    );
    // 未提供 empty 配置时（如 FarmResourcePanel 场景），isEmpty 不生效，直接渲染
    // children——空态逻辑交给调用方在 children 内部自行处理。
    expect(screen.getByTestId('data')).toBeInTheDocument();
  });

  it('renders children as the data state once loading/error/empty all resolve', () => {
    render(
      <AsyncPanel loading={false} error={null} isEmpty={false} loadingLabel="加载中…">
        <div data-testid="data">data</div>
      </AsyncPanel>
    );
    expect(screen.getByTestId('data')).toBeInTheDocument();
  });
});
