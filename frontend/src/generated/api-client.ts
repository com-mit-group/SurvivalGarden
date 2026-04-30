/**
 * GENERATED FILE - DO NOT EDIT.
 * OpenAPI source: http://127.0.0.1:5178/openapi-v1.json
 * Contract version: 1.0.0
 * Persisted schemaVersion baseline: 2
 * Regenerate with `pnpm --filter frontend gen:types`.
 */

export type BackendApiPath =
  | '/health'
  | '/'
  | '/api/app-state'
  | '/api/settings'
  | '/api/species'
  | '/api/species/{id}'
  | '/api/crops'
  | '/api/crops/{id}'
  | '/api/cultivars'
  | '/api/cultivars/{id}'
  | '/api/segments'
  | '/api/segments/{id}'
  | '/api/seedInventoryItems'
  | '/api/seedInventoryItems/{id}'
  | '/api/cropPlans'
  | '/api/cropPlans/{id}'
  | '/api/beds'
  | '/api/beds/{id}'
  | '/api/segments/{id}/beds'
  | '/api/segments/{id}/paths'
  | '/api/paths/{id}'
  | '/api/validate/{collection}'
  | '/api/batches'
  | '/api/batches/{id}'
  | '/api/batches/{id}/stage-events'
  | '/api/batches/{id}/assign-bed'
  | '/api/batches/{id}/unassign-bed'
  | '/api/batches/{id}/move-bed'
  | '/api/batches/{id}/complete'
  | '/api/domain/batches/{id}/stage-events'
  | '/api/domain/batches/{id}/assignment'
  | '/api/domain/tasks/regenerate-calendar';

export const backendApiFetch = async <T>(
  path: BackendApiPath,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`Backend API request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
};
