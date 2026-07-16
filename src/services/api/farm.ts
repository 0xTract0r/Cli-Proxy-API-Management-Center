/**
 * 农场编排器（Device Farm）API
 *
 * 端点契约照抄 services/farm-orchestrator/internal/httpapi/{dto.go,handlers.go}：
 * - GET    /api/farm/containers?status=<all|具体状态>（不传=默认活跃视图，排除 retired/orphaned）
 * - POST   /api/farm/containers          body: { id }
 * - DELETE /api/farm/containers/{id}?delete_volume=<true|false>
 * - GET    /api/farm/accounts?env=<env>
 * - POST   /api/farm/bindings            body: { container_id, account_id, env, auth_index? }
 * - DELETE /api/farm/bindings/{container_id}
 * - GET    /api/farm/usage?env=<env>
 * - GET    /api/farm/resources
 */

import { farmClient } from './farmClient';
import type {
  FarmAccountEntry,
  FarmBindingResponse,
  FarmContainerView,
  FarmCreateBindingRequest,
  FarmCreateContainerRequest,
  FarmEnv,
  FarmResourceResponse,
  FarmRetireContainerResponse,
  FarmUnbindResponse,
  FarmUsageResponse,
} from '@/types/farm';

// handleListContainers 的 status 语义：不传=默认活跃视图（后端排除 retired/
// orphaned）；'all'=含归档全量；具体状态值=只筛该状态（含 retired/orphaned）。
// 前端这里不重复这套判定逻辑，原样透传 query 字符串给后端。
export type FarmListContainersStatus = 'all' | string;

export const farmApi = {
  listContainers: (status?: FarmListContainersStatus) =>
    farmClient.get<FarmContainerView[]>('/api/farm/containers', {
      params: status ? { status } : undefined,
    }),

  createContainer: (request: FarmCreateContainerRequest) =>
    farmClient.post<FarmContainerView>('/api/farm/containers', request),

  // 退役容器（软删归档）：默认保留专属卷（含 machineID/claude 状态，误删不可
  // 逆），deleteVolume=true 才连卷一起删。已绑定容器后端会拒绝（409，需先解绑）。
  retireContainer: (containerId: string, options?: { deleteVolume?: boolean }) =>
    farmClient.delete<FarmRetireContainerResponse>(
      `/api/farm/containers/${encodeURIComponent(containerId)}`,
      { params: { delete_volume: options?.deleteVolume ? 'true' : 'false' } }
    ),

  listAccounts: (env: FarmEnv) =>
    farmClient.get<FarmAccountEntry[]>('/api/farm/accounts', { params: { env } }),

  createBinding: (request: FarmCreateBindingRequest) =>
    farmClient.post<FarmBindingResponse>('/api/farm/bindings', request),

  deleteBinding: (containerId: string) =>
    farmClient.delete<FarmUnbindResponse>(`/api/farm/bindings/${encodeURIComponent(containerId)}`),

  // Token 用量按容器/账号聚合，口径见 FarmUsageResponse.note（CPA 自上次重启起
  // 的内存态计数，不持久）。env 可选：不传时后端聚合全部已绑定 env。
  getUsage: (env?: FarmEnv) =>
    farmClient.get<FarmUsageResponse>('/api/farm/usage', {
      params: env ? { env } : undefined,
    }),

  // 容器 + 整机资源快照（mem/cpu），host.note 固定携带"整机含非农场进程"口径。
  getResources: () => farmClient.get<FarmResourceResponse>('/api/farm/resources'),
};
