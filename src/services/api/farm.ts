/**
 * 农场编排器（Device Farm）API
 *
 * 端点契约照抄 services/farm-orchestrator/internal/httpapi/{dto.go,handlers.go}：
 * - GET    /api/farm/containers
 * - POST   /api/farm/containers          body: { id }
 * - GET    /api/farm/accounts?env=<env>
 * - POST   /api/farm/bindings            body: { container_id, account_id, env, auth_index? }
 * - DELETE /api/farm/bindings/{container_id}
 */

import { farmClient } from './farmClient';
import type {
  FarmAccountEntry,
  FarmBindingResponse,
  FarmContainerView,
  FarmCreateBindingRequest,
  FarmCreateContainerRequest,
  FarmEnv,
  FarmUnbindResponse,
} from '@/types/farm';

export const farmApi = {
  listContainers: () => farmClient.get<FarmContainerView[]>('/api/farm/containers'),

  createContainer: (request: FarmCreateContainerRequest) =>
    farmClient.post<FarmContainerView>('/api/farm/containers', request),

  listAccounts: (env: FarmEnv) =>
    farmClient.get<FarmAccountEntry[]>('/api/farm/accounts', { params: { env } }),

  createBinding: (request: FarmCreateBindingRequest) =>
    farmClient.post<FarmBindingResponse>('/api/farm/bindings', request),

  deleteBinding: (containerId: string) =>
    farmClient.delete<FarmUnbindResponse>(`/api/farm/bindings/${encodeURIComponent(containerId)}`),
};
