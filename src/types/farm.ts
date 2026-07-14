/**
 * 农场编排器（Device Farm）类型定义
 *
 * 字段名照抄 services/farm-orchestrator/internal/httpapi/dto.go 与
 * internal/cpa/client.go 的 JSON 契约，不臆造字段。农场编排器是独立后端，
 * 走独立 base URL + 独立 admin key（见 farmClient.ts / useFarmStore.ts），
 * 不复用 CPA 的 /v0/management 契约。
 */

// GET /api/farm/containers 单条记录的 binding 子结构（dto.go bindingView）
export interface FarmBindingView {
  env: string;
  account: string;
  auth_index?: number;
  bound_at: string;
}

// GET /api/farm/containers 单条记录（dto.go containerView）
// device_id 只暴露脱敏前 16 位，真实值不经这个只读接口回吐。
export interface FarmContainerView {
  id: string;
  device_id_masked: string;
  status: string;
  residential_ip?: string;
  token_usage?: number;
  last_keepalive_at?: string;
  created_at: string;
  updated_at: string;
  binding?: FarmBindingView;
}

// 容器状态取值（store.Status* 常量，供前端徽标着色用；未知值按 fallback 灰色处理）
export const FARM_CONTAINER_STATUSES = [
  'created',
  'starting',
  'running',
  'degraded',
  'down',
] as const;
export type FarmContainerStatus = (typeof FARM_CONTAINER_STATUSES)[number];

// 环境枚举（store.IsValidEnv 只认 test / prod）
export const FARM_ENVS = ['test', 'prod'] as const;
export type FarmEnv = (typeof FARM_ENVS)[number];

// POST /api/farm/containers 请求体（dto.go createContainerRequest）
export interface FarmCreateContainerRequest {
  id: string;
}

// POST /api/farm/bindings 请求体（dto.go createBindingRequest）
export interface FarmCreateBindingRequest {
  container_id: string;
  account_id: string;
  env: FarmEnv;
  auth_index?: number;
}

// POST /api/farm/bindings 响应体（dto.go bindingResponse）
export interface FarmBindingResponse {
  container_id: string;
  account_id: string;
  env: string;
  auth_index?: number;
  bound_at: string;
  device_write: 'ok' | 'pending' | 'failed';
  detail?: string;
}

// DELETE /api/farm/bindings/{id} 响应体（handlers.go handleDeleteBinding）
export interface FarmUnbindResponse {
  device_write: string;
  detail: string;
}

// GET /api/farm/accounts?env=<env> 单条记录（cpa/client.go AuthFileEntry，
// 编排器透传 CPA GET /auth-files 账号健康列表，字段是骨架，未来可能扩充）
export interface FarmAccountEntry {
  name: string;
  status: string;
  disabled: boolean;
  last_refresh?: string;
  reauth_url?: string;
  proxy_url?: string;
  device_id?: string;
  success?: number;
  failed?: number;
  recent_requests?: number;
  auth_index?: number;
}

// httpapi errorResponse
export interface FarmErrorResponse {
  error: string;
}
