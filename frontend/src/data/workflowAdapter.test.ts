import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isCutoverCompleteWorkflow,
  isWorkflowRoutedToBackend,
  shouldUseCanonicalBackendPath,
  shouldUseTypescriptRollbackShim,
  workflowAdapter,
} from './workflowAdapter';

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

describe('workflow routing flags', () => {
  it('keeps routing disabled outside backend mode', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'typescript');
    vi.stubEnv('VITE_ROUTE_BATCHES_TO_BACKEND', 'true');

    expect(isWorkflowRoutedToBackend('batches')).toBe(false);
  });

  it('enables only explicitly flagged workflows in backend mode', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_ROUTE_BATCHES_TO_BACKEND', 'true');
    vi.stubEnv('VITE_ROUTE_TASKS_TO_BACKEND', 'false');
    vi.stubEnv('VITE_ROUTE_BEDS_SEGMENTS_TO_BACKEND', 'true');
    vi.stubEnv('VITE_ROUTE_TAXONOMY_TO_BACKEND', 'false');
    vi.stubEnv('VITE_ROUTE_INVENTORY_TO_BACKEND', 'true');

    expect(isWorkflowRoutedToBackend('batches')).toBe(true);
    expect(isWorkflowRoutedToBackend('tasks')).toBe(false);
    expect(isWorkflowRoutedToBackend('bedsSegments')).toBe(true);
    expect(isWorkflowRoutedToBackend('taxonomy')).toBe(false);
    expect(isWorkflowRoutedToBackend('inventory')).toBe(true);
  });

  it('treats parity-accepted workflows as canonical backend paths', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_PARITY_ACCEPTED_WORKFLOWS', 'batches,tasks,bedsSegments,taxonomy,inventory');
    vi.stubEnv('VITE_ROUTE_BATCHES_TO_BACKEND', 'false');
    vi.stubEnv('VITE_ROUTE_BEDS_SEGMENTS_TO_BACKEND', 'false');
    vi.stubEnv('VITE_ROUTE_TAXONOMY_TO_BACKEND', 'false');
    vi.stubEnv('VITE_ROUTE_INVENTORY_TO_BACKEND', 'false');

    expect(shouldUseCanonicalBackendPath('batches')).toBe(true);
    expect(shouldUseCanonicalBackendPath('bedsSegments')).toBe(true);
    expect(shouldUseCanonicalBackendPath('taxonomy')).toBe(true);
    expect(shouldUseCanonicalBackendPath('inventory')).toBe(true);
  });

  it('keeps rollback shim disabled unless explicitly enabled', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_PARITY_ACCEPTED_WORKFLOWS', 'batches');

    expect(shouldUseTypescriptRollbackShim('batches')).toBe(false);
  });

  it('re-enables rollback shim for accepted workflows when rollback flags are enabled', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_PARITY_ACCEPTED_WORKFLOWS', 'batches,tasks,taxonomy');
    vi.stubEnv('VITE_ENABLE_TYPESCRIPT_ROLLBACK_SHIMS', 'true');
    vi.stubEnv('VITE_TYPESCRIPT_ROLLBACK_WORKFLOWS', 'batches,taxonomy');

    expect(shouldUseTypescriptRollbackShim('batches')).toBe(true);
    expect(shouldUseTypescriptRollbackShim('tasks')).toBe(false);
    expect(shouldUseTypescriptRollbackShim('taxonomy')).toBe(true);
  });
  it('treats workflows as cutover-complete only when parity accepted and marked complete', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_PARITY_ACCEPTED_WORKFLOWS', 'batches,tasks');
    vi.stubEnv('VITE_CUTOVER_COMPLETE_WORKFLOWS', 'batches');

    expect(isCutoverCompleteWorkflow('batches')).toBe(true);
    expect(isCutoverCompleteWorkflow('tasks')).toBe(false);
  });

  it('keeps rollback shims disabled for cutover-complete workflows unless emergency kill switch is enabled', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_PARITY_ACCEPTED_WORKFLOWS', 'batches');
    vi.stubEnv('VITE_CUTOVER_COMPLETE_WORKFLOWS', 'batches');
    vi.stubEnv('VITE_ENABLE_TYPESCRIPT_ROLLBACK_SHIMS', 'true');
    vi.stubEnv('VITE_TYPESCRIPT_ROLLBACK_WORKFLOWS', 'batches');

    expect(shouldUseTypescriptRollbackShim('batches')).toBe(false);

    vi.stubEnv('VITE_ENABLE_EMERGENCY_TYPESCRIPT_ROLLBACK', 'true');
    expect(shouldUseTypescriptRollbackShim('batches')).toBe(true);
  });

});

describe('workflow adapter transport', () => {
  it('posts stage transitions to the backend domain endpoint', async () => {
    vi.stubEnv('VITE_BACKEND_API_BASE_URL', 'http://localhost:5142');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ batchId: 'batch-1', stage: 'harvest' }),
    } as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    const batch = await workflowAdapter.batches.transitionStage('batch-1', 'harvest', '2026-04-01T00:00:00Z');

    expect(batch.batchId).toBe('batch-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5142/api/domain/batches/batch-1/stage-events',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('uses explicit CRUD endpoints for beds/segments, taxonomy, and inventory adapters', async () => {
    vi.stubEnv('VITE_BACKEND_API_BASE_URL', 'http://localhost:5142');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    await workflowAdapter.bedsSegments.listBeds();
    await workflowAdapter.taxonomy.listCrops();
    await workflowAdapter.inventory.listSeedInventoryItems();

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:5142/api/beds', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:5142/api/crops', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:5142/api/seedInventoryItems',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
