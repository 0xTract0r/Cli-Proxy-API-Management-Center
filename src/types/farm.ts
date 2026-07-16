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
// retired = 已退役（软删归档，容器与卷按 delete_volume 参数决定是否清）；
// orphaned = 幽灵态（注册表存在但对应容器/绑定关系异常，等待 operator 收敛为 retired）。
// 两者都属于 store.IsArchivedStatus，默认容器列表视图会排除，见 handleListContainers。
export const FARM_CONTAINER_STATUSES = [
  'created',
  'starting',
  'running',
  'degraded',
  'down',
  'retired',
  'orphaned',
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

// DELETE /api/farm/containers/{id}?delete_volume= 响应体（dto.go retireContainerResponse）
export interface FarmRetireContainerResponse {
  id: string;
  status: string; // 恒为 store.StatusRetired
  already_retired?: boolean;
  volume_deleted: boolean;
  detail?: string;
}

// device_id 溯源标注取值（dto.go deviceSource* 常量，spec「device_id 展示口径全站对齐」）：
//   - container_synced：农场绑定 + 注册表钉值与 CPA 当前 synthetic 前缀一致，真实容器同步。
//   - drift：农场绑定但 CPA 当前值与钉值前缀不一致，poller 下一轮会兜回，仍是农场真实来源。
//   - synthetic：非农场绑定账号，CPA 按账号派生 synthetic，标合成是准确的。
//   - unknown：后端无法确定绑定关系（注册表查询失败等）→ 中性回退，不谎称合成也不谎称真实容器同步。
export const FARM_DEVICE_ID_SOURCES = ['container_synced', 'drift', 'synthetic', 'unknown'] as const;
export type FarmDeviceIDSource = (typeof FARM_DEVICE_ID_SOURCES)[number];

// GET /api/farm/accounts?env=<env> 单条记录（cpa/client.go AuthFileEntry，
// 编排器透传 CPA GET /auth-files 账号健康列表，字段是骨架，未来可能扩充）
// 农场绑定溯源字段（dto.go accountView 内嵌 cpa.AuthFileEntry + 以下字段）：
// farm_bound / device_id_source 后端恒返回；farm_container_id / farm_env /
// farm_container_status / pinned_device_id_masked 只在 farm_bound=true 时存在
// （Go 侧 omitempty），非农场账号不出现这几个字段。
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
  // 该账号在本 env 下是否有农场容器绑定。
  farm_bound: boolean;
  // 绑定的容器 ID（仅 farm_bound=true 时存在）。
  farm_container_id?: string;
  // 绑定所在环境（仅 farm_bound=true 时存在，理论上与请求的 env 一致）。
  farm_env?: string;
  // 绑定容器在注册表的当前状态（running/degraded/orphaned…，仅 farm_bound=true 时存在）。
  farm_container_status?: string;
  // 注册表钉死的 device_id 脱敏前 16 位（农场真源，仅 farm_bound=true 时存在）。
  pinned_device_id_masked?: string;
  // device_id 展示口径来源标注，恒有值。
  device_id_source: FarmDeviceIDSource;
}

// GET /api/farm/usage 单条记录（services/farm-orchestrator 新增 usage 端点：
// 按容器/账号聚合 CPA GET /v0/management/usage?include_details=true 的
// details[]，只保留农场绑定账号；数据是 CPA 自上次重启起的内存态计数，不持久）
// 字段按 201 实测订正：无 cache_creation，改为 reasoning + billable（billable
// 是 CPA 计费口径下的实际计费 token 数，不等同于 total）。
export interface FarmUsageTokens {
  input: number;
  output: number;
  cache_read: number;
  reasoning: number;
  total: number;
  billable: number;
}

export interface FarmUsageItem {
  container_id: string;
  account_id: string;
  // 绑定账号邮箱（CPA AuthFileEntry 透传），非农场绑定或账号无邮箱信息时可能
  // 是空字符串，前端按空值不渲染处理，不臆造占位邮箱。
  account_email: string;
  env: FarmEnv;
  auth_index: number;
  tokens: FarmUsageTokens;
  cost_usd: number;
  requests: number;
}

// GET /api/farm/usage 响应体。note 固定携带口径说明（"自 CPA 上次重启起
// (内存态)"），前端应原样展示，不要另造措辞。
export interface FarmUsageResponse {
  items: FarmUsageItem[];
  note: string;
}

// GET /api/farm/resources 单条容器资源记录（对已绑定且 running 的农场容器执行
// docker stats --no-stream 解析得到；取不到时数值字段回退 0，不臆造）
export interface FarmResourceContainer {
  container_id: string;
  account_id: string;
  mem_used_bytes: number;
  mem_limit_bytes: number;
  mem_pct: number;
  cpu_pct: number;
}

// GET /api/farm/resources host 字段：整机资源快照（/proc/meminfo + /proc/loadavg +
// runtime.NumCPU()），note 固定携带"整机含非农场进程"口径说明，前端应原样展示。
export interface FarmResourceHost {
  mem_used_bytes: number;
  mem_total_bytes: number;
  mem_pct: number;
  load1: number;
  cpu_count: number;
  note: string;
}

// GET /api/farm/resources 响应体。
export interface FarmResourceResponse {
  containers: FarmResourceContainer[];
  host: FarmResourceHost;
}

// httpapi errorResponse
export interface FarmErrorResponse {
  error: string;
}
