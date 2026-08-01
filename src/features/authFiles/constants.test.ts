// @ts-nocheck
// 占位单测（reauth 纵深防御兜底）：与 components/AuthFileCard.test.tsx 一致，本仓库
// 当前未接入 Vitest（apps/web/package.json 无 vitest devDependency，也无 vitest.config），
// `vitest` 模块无法解析。`@ts-nocheck` 仅为避免 tsconfig `include: ["src"]` 把本文件
// 一并类型检查时因缺 `vitest` 模块而报错；本文件不会被任何脚本执行，只作为验收骨架，
// 与 cpamp 的 features/authFiles/constants.test.ts 逐点对齐（那边接了 vitest 会真跑）。
//
// 覆盖点（纵深防御：reauth_required 死 token 账号绝不显示为绿色正常）：
//  ① hasAuthFileStatusWarning 对带 reauth_url / reauth_required 的账号返回 true，
//     且必须先于 unavailable=false 短路（避免 core 尚未置 unavailable 时漏判假绿）；
//  ② 「仅显示有问题凭证」筛选（files.filter(hasAuthFileStatusWarning)）包含该账号；
//  ③ 「仅显示正常凭证」筛选（!disabled && !hasAuthFileStatusWarning）排除该账号。
import { describe, expect, it } from 'vitest';
import type { AuthFileItem } from '@/types';
import {
  hasAuthFileStatusWarning,
  isAuthFileAutoQuarantined,
  isAuthFileReauthRequired,
} from './constants';

const baseFile: AuthFileItem = {
  name: 'acct.json',
  type: 'qwen',
  disabled: false,
};

// apps/web 没有独立的 isHealthyAuthFile 导出：AuthFilesPage 的「仅显示正常账号」
// 筛选谓词是 `!file.disabled && !hasAuthFileStatusWarning(file)`，这里原样镜像。
const isNormalOnly = (file: AuthFileItem): boolean =>
  file.disabled !== true && !hasAuthFileStatusWarning(file);

describe('hasAuthFileStatusWarning priority (with reauth defense-in-depth)', () => {
  it('returns false for a fully healthy account', () => {
    expect(hasAuthFileStatusWarning(baseFile)).toBe(false);
  });

  it('prioritizes auto_quarantined over a healthy-looking status_message', () => {
    const quarantined: AuthFileItem = {
      ...baseFile,
      status_message: 'ok',
      auto_quarantined: true,
      quarantine_reason: 'terminal_auth_failure',
    };
    expect(isAuthFileAutoQuarantined(quarantined)).toBe(true);
    expect(hasAuthFileStatusWarning(quarantined)).toBe(true);
  });

  it('treats a non-empty reauth_url as a warning even when unavailable=false (before the unavailable short-circuit)', () => {
    const reauthNeeded: AuthFileItem = {
      ...baseFile,
      type: 'claude',
      unavailable: false,
      status_message: 'ok',
      reauth_url: 'https://claude.ai/oauth/reauthorize?x=1',
    };
    expect(hasAuthFileStatusWarning(reauthNeeded)).toBe(true);
  });

  it('treats a truthy reauth_required flag (top-level and metadata) as a warning', () => {
    expect(hasAuthFileStatusWarning({ ...baseFile, reauth_required: true })).toBe(true);
    expect(
      hasAuthFileStatusWarning({
        ...baseFile,
        unavailable: false,
        metadata: { reauth_required: true },
      })
    ).toBe(true);
  });

  it('falls back to structured unavailable when there is no reauth signal', () => {
    expect(hasAuthFileStatusWarning({ ...baseFile, unavailable: true })).toBe(true);
    expect(hasAuthFileStatusWarning({ ...baseFile, unavailable: false })).toBe(false);
  });
});

describe('isAuthFileReauthRequired', () => {
  it('returns false for a healthy account with no reauth signal', () => {
    expect(isAuthFileReauthRequired(baseFile)).toBe(false);
  });

  it('detects reauth_url, reauth_required, and metadata.reauth_required', () => {
    expect(isAuthFileReauthRequired({ ...baseFile, reauth_url: 'https://x' })).toBe(true);
    expect(isAuthFileReauthRequired({ ...baseFile, reauth_required: true })).toBe(true);
    expect(isAuthFileReauthRequired({ ...baseFile, reauth_required: 'yes' })).toBe(true);
    expect(isAuthFileReauthRequired({ ...baseFile, metadata: { reauth_required: 1 } })).toBe(true);
  });

  it('ignores empty / falsy reauth signals', () => {
    expect(isAuthFileReauthRequired({ ...baseFile, reauth_url: '   ' })).toBe(false);
    expect(isAuthFileReauthRequired({ ...baseFile, reauth_required: false })).toBe(false);
  });
});

describe('reauth account across the health filters', () => {
  const reauthNeeded: AuthFileItem = {
    ...baseFile,
    type: 'claude',
    unavailable: false,
    status_message: 'ok',
    reauth_url: 'https://claude.ai/oauth/reauthorize?x=1',
  };

  it('is included by the "problem only" filter and excluded by the "normal only" filter', () => {
    const files = [baseFile, reauthNeeded];
    // 「仅显示有问题凭证」：files.filter(hasAuthFileStatusWarning)
    expect(files.filter(hasAuthFileStatusWarning)).toContain(reauthNeeded);
    // 「仅显示正常凭证」：!disabled && !hasAuthFileStatusWarning
    expect(files.filter(isNormalOnly)).not.toContain(reauthNeeded);
    expect(files.filter(isNormalOnly)).toContain(baseFile);
  });
});
