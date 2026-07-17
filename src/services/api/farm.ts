/**
 * 农场编排器（Device Farm）API
 *
 * 端点契约照抄 services/farm-orchestrator/internal/httpapi/{dto.go,handlers.go,
 * observability.go}：
 * - GET    /api/farm/containers?status=<all|具体状态>（不传=默认活跃视图，排除 retired/orphaned）
 * - POST   /api/farm/containers          body: { id }
 * - DELETE /api/farm/containers/{id}?delete_volume=<true|false>
 * - GET    /api/farm/accounts?env=<env>
 * - POST   /api/farm/bindings            body: { container_id, account_id, env, auth_index? }
 * - DELETE /api/farm/bindings/{container_id}
 * - GET    /api/farm/usage?env=<env>
 * - GET    /api/farm/resources
 * - GET    /api/farm/overview（P0-4，design.md 决策4 KPI 聚合）
 * - GET    /api/farm/containers/{id}                    聚合详情
 * - GET    /api/farm/containers/{id}/keepalive?window=&step=   心跳时序 step 分桶
 * - GET    /api/farm/containers/{id}/resources?window=&step=   资源时序 step 分桶
 * - GET    /api/farm/containers/{id}/events              当前 firing 事件（非完整历史）
 * - GET    /api/farm/alerts?window=&status=              跨容器告警 feed（P0-5，
 *          已注册并测试通过，见下方 getAlerts 注释）
 * - POST   /api/farm/onboard body: { account_id, env, proxy_url?, container_id? }
 *          半自动 onboard（design.md 决策5，P0-10）。后端 P0-6 已落地并注册
 *          路由，成功体 = bindingResponse + container_created；失败体是独立
 *          形状 onboardErrorResponse{ error, code }，机器码在 code 字段。
 */

import { farmClient } from './farmClient';
import type {
  FarmAccountEntry,
  FarmAlertsResponse,
  FarmBindingResponse,
  FarmContainerDetailView,
  FarmContainerEventsResponse,
  FarmContainerView,
  FarmCreateBindingRequest,
  FarmCreateContainerRequest,
  FarmEnv,
  FarmKeepaliveSeriesResponse,
  FarmOnboardRequest,
  FarmOnboardResponse,
  FarmOverviewResponse,
  FarmResourceResponse,
  FarmResourceSeriesResponse,
  FarmRetireContainerResponse,
  FarmUnbindResponse,
  FarmUsageResponse,
} from '@/types/farm';

// GET .../keepalive、.../resources 共用的 window/step 查询参数（httpapi
// parseWindowAndStep：Go duration 字符串 "24h"/"30m"/"90s" + 扩展 "d" 后缀，
// 不传时后端默认 window=24h/step=1h）。
export interface FarmSeriesQuery {
  window?: string;
  step?: string;
}

// GET /api/farm/alerts 查询参数（design.md 决策4「window/status，
// firing/resolved」）；P0-5 后端契约细节待核实，见 farmApi.getAlerts 注释。
export interface FarmAlertsQuery {
  window?: string;
  status?: 'firing' | 'resolved' | 'all';
}

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

  // 半自动 onboard（P0-10，design.md 决策5）：对「已认证但未接入农场」账号
  // 一键接入，编排器内部按「无空闲容器则建容器→绑定→起容器」原子链路处理，
  // 前端不重复 createContainer + createBinding 两步（那两步仍保留在
  // FarmContainerTable 作为高级/兜底路径）。proxy_url/container_id 可选，
  // 不传交由后端按 env 自行判定。失败态机器码在响应体独立 code 字段（不在
  // error 文本里），farmClient 解析进 FarmApiError.businessCode，调用方
  // （useFarmOnboard）按 businessCode 精确匹配，不做文本子串匹配。
  onboardAccount: (accountId: string, env: FarmEnv, options?: { proxy_url?: string; container_id?: string }) =>
    farmClient.post<FarmOnboardResponse>('/api/farm/onboard', {
      account_id: accountId,
      env,
      ...(options?.proxy_url ? { proxy_url: options.proxy_url } : {}),
      ...(options?.container_id ? { container_id: options.container_id } : {}),
    } satisfies FarmOnboardRequest),

  // Token 用量按容器/账号聚合，口径见 FarmUsageResponse.note（CPA 自上次重启起
  // 的内存态计数，不持久）。env 可选：不传时后端聚合全部已绑定 env。
  getUsage: (env?: FarmEnv) =>
    farmClient.get<FarmUsageResponse>('/api/farm/usage', {
      params: env ? { env } : undefined,
    }),

  // 容器 + 整机资源快照（mem/cpu），host.note 固定携带"整机含非农场进程"口径。
  getResources: () => farmClient.get<FarmResourceResponse>('/api/farm/resources'),

  // ---------------------------------------------------------------------
  // P0-9：概览 + 下钻 + 告警消费的只读监测 API（P0-4 已交付，P0-5 见下方注释）
  // ---------------------------------------------------------------------

  // KPI 聚合：各状态容器数 / 活跃告警数 / 心跳陈旧数 / device_id 漂移数（占位0）
  // / 探针 cost（占位 undefined）/ 响应生成时间。
  getOverview: () => farmClient.get<FarmOverviewResponse>('/api/farm/overview'),

  // 单容器聚合详情（containerView 全部字段 + 当前 firing 事件）。
  getContainerDetail: (containerId: string) =>
    farmClient.get<FarmContainerDetailView>(
      `/api/farm/containers/${encodeURIComponent(containerId)}`
    ),

  // 心跳时序 step 分桶（成功率、avg/p95 latency）。空窗口返回空 buckets 而非
  // error（spec「容器详情时序」Scenario）。
  getContainerKeepalive: (containerId: string, query?: FarmSeriesQuery) =>
    farmClient.get<FarmKeepaliveSeriesResponse>(
      `/api/farm/containers/${encodeURIComponent(containerId)}/keepalive`,
      { params: query }
    ),

  // 资源时序 step 分桶（avg/max mem、avg/max cpu）。
  getContainerResources: (containerId: string, query?: FarmSeriesQuery) =>
    farmClient.get<FarmResourceSeriesResponse>(
      `/api/farm/containers/${encodeURIComponent(containerId)}/resources`,
      { params: query }
    ),

  // 当前 firing 中的事件（非完整历史时间线，见 FarmEventView.resolved_at 注释）。
  getContainerEvents: (containerId: string) =>
    farmClient.get<FarmContainerEventsResponse>(
      `/api/farm/containers/${encodeURIComponent(containerId)}/events`
    ),

  // 跨容器告警 feed（design.md 决策4）。P0-5 已交付：
  // services/farm-orchestrator/internal/httpapi/server.go 注册
  // `GET /api/farm/alerts`（handleGetAlerts），dto.go 定义响应体
  // `alertsResponse{ window, status, alerts: []eventView }`，与
  // types/farm.ts FarmAlertsResponse（`{ alerts: FarmAlertEntry[] }`）对齐。
  // 请求失败时走 farmClient 既有错误处理，<FarmAlertsPanel> 的 AsyncPanel
  // error 态如实呈现，不会伪造成功响应。
  getAlerts: (query?: FarmAlertsQuery) =>
    farmClient.get<FarmAlertsResponse>('/api/farm/alerts', { params: query }),
};
