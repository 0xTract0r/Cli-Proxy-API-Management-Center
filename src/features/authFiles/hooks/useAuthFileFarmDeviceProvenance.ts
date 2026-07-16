import { useEffect, useState } from 'react';
import { farmApi } from '@/services/api/farm';
import { useFarmStore } from '@/stores';
import { FARM_ENVS, type FarmAccountEntry, type FarmDeviceIDSource } from '@/types/farm';

/**
 * auth-files 账号设置弹窗里、device_id 展示口径的农场溯源结果。
 *
 * 四态判定收敛在 `resolveFarmDeviceProvenance`（纯函数）：
 * - 农场编排器未配置 / 跨 env 都 join 不到该账号 / 后端明确返回非农场绑定
 *   （不论 device_id_source 字面量是什么）→ 一律回退 `synthetic`，因为
 *   农场是可选组件、绝大多数账号本来就不农场绑定，此时"合成"才是准确
 *   展示，不能整体退化成中性 `unknown`。
 * - 只有农场已配置、且该账号确实农场绑定（`farm_bound=true`）、但后端仍
 *   给出 `unknown`（注册表查询失败等真正判不定的情形）时，才展示中性
 *   `unknown`。
 * - `container_synced` / `drift` 在确认农场绑定时原样透传。
 */
export type AuthFileFarmDeviceProvenance = {
  source: FarmDeviceIDSource;
  entry: FarmAccountEntry | null;
};

/**
 * 未配置农场 / 跨 env 都 join 不到 / 后端明确非绑定时的统一回退态：按原有
 * （无农场概念时就有的）合成展示口径显示，`entry` 为 null 表示前端没有可
 * 用的农场侧记录（调用方不应据此渲染 farm_container_id / farm_env 等字段）。
 */
export const SYNTHETIC_FALLBACK_PROVENANCE: AuthFileFarmDeviceProvenance = {
  source: 'synthetic',
  entry: null,
};

/**
 * 纯函数：按 auth 文件名（大小写不敏感、去首尾空白）在跨 env 拉到的农场
 * 账号列表里 join 当前正在编辑的账号，解析出展示口径。不发请求、无副作用，
 * 便于单测（另见 gaps：本仓库 apps/web 未配置单测 runner，暂无法接入运行）。
 *
 * 匹配约定：
 * - 多个 env 都命中同名账号（理论上不该发生——只有不同 env 各自代理的 CPA
 *   恰好有同名账号时才会）优先取 farm_bound=true 的条目；否则按
 *   envAccountLists 的数组顺序（即调用方传入的 env 顺序）取第一个命中。
 * - 一个都没命中 → 合成回退，不臆造 farm_bound / device_id_source。
 * - 命中但 farm_bound=false（后端明确非绑定，含"注册表整体查询失败"这类
 *   backend 侧 unknown 快照——此时 farm_bound 同样为 false）→ 同样按合成
 *   回退展示，不强行套用后端字面量 device_id_source。
 * - 命中且 farm_bound=true → 原样透传 container_synced / drift / unknown。
 */
export function resolveFarmDeviceProvenance(
  fileName: string | null | undefined,
  envAccountLists: FarmAccountEntry[][]
): AuthFileFarmDeviceProvenance {
  const name = (fileName || '').trim().toLowerCase();
  if (!name) return SYNTHETIC_FALLBACK_PROVENANCE;

  const candidates: FarmAccountEntry[] = [];
  for (const list of envAccountLists) {
    for (const entry of list) {
      if ((entry.name || '').trim().toLowerCase() === name) {
        candidates.push(entry);
      }
    }
  }
  if (candidates.length === 0) return SYNTHETIC_FALLBACK_PROVENANCE;

  const bound = candidates.find((entry) => entry.farm_bound);
  const chosen = bound || candidates[0];
  if (!chosen.farm_bound) {
    // 后端明确非绑定：不论字面量是 synthetic 还是 unknown（例如注册表整体
    // 查询失败时后端也会给 unknown，但 farm_bound 仍是 false），都按合成
    // 回退展示——"判不定"的中性态只保留给确认农场绑定的场景。
    return { source: 'synthetic', entry: chosen };
  }
  return { source: chosen.device_id_source, entry: chosen };
}

/**
 * 跨 env（FARM_ENVS：test/prod）查询农场编排器 GET /api/farm/accounts，
 * 按 auth 文件名 join 出当前账号的 device_id 展示口径。
 *
 * farmClient 是独立后端 + 独立配置（见 services/api/farmClient.ts），与
 * auth-files 页面本身连接的 CPA 无耦合关系，因此这里必须跨两个 env 分别
 * 查询——不能假设编排器当前配的 env 与本账号所在 CPA 一致。
 *
 * 这里只做只读展示，任何失败（未配置 / 请求异常 / 网络错误）都收敛成合成
 * 回退，绝不能让本区块因为农场编排器不可达而崩溃或让整个弹窗/整页白屏。
 *
 * 实现注意：`shouldQuery=false`（无文件名 / 农场未配置）时直接在返回语句
 * 短路成 `SYNTHETIC_FALLBACK_PROVENANCE`，不依赖内部 state、也不在 effect
 * 体内为这种情形同步 setState——`react-hooks/set-state-in-effect` 禁止在
 * effect 函数体的同步部分直接调用 setState，只允许在异步回调（`await` 之
 * 后）里调用。内部 state 只在真正发起跨 env 查询、拿到结果后才更新。
 */
export function useAuthFileFarmDeviceProvenance(
  fileName: string | null
): AuthFileFarmDeviceProvenance {
  const isConfigured = useFarmStore((state) => state.isConfigured);
  const name = (fileName || '').trim();
  const shouldQuery = Boolean(name) && isConfigured;

  const [fetched, setFetched] = useState<AuthFileFarmDeviceProvenance>(
    () => SYNTHETIC_FALLBACK_PROVENANCE
  );

  useEffect(() => {
    if (!shouldQuery) {
      // 不满足查询条件：不发请求，也不在此同步 setState——调用方在下方
      // return 语句里直接按 shouldQuery 短路到合成回退态。
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const results = await Promise.allSettled(
          FARM_ENVS.map((env) => farmApi.listAccounts(env))
        );
        if (cancelled) return;
        const envAccountLists = results.map((result) =>
          result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []
        );
        setFetched(resolveFarmDeviceProvenance(name, envAccountLists));
      } catch {
        // 防御性兜底：Promise.allSettled 本身不会 reject，这里只是双保险，
        // 避免任何未预期的同步抛错把弹窗渲染带崩。
        if (!cancelled) setFetched(SYNTHETIC_FALLBACK_PROVENANCE);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [name, shouldQuery]);

  return shouldQuery ? fetched : SYNTHETIC_FALLBACK_PROVENANCE;
}
