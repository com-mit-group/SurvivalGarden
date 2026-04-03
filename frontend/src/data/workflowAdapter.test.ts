import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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

    expect(isWorkflowRoutedToBackend('batches')).toBe(true);
    expect(isWorkflowRoutedToBackend('tasks')).toBe(false);
  });

  it('treats parity-accepted workflows as canonical backend paths', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_PARITY_ACCEPTED_WORKFLOWS', 'batches,tasks');
    vi.stubEnv('VITE_ROUTE_BATCHES_TO_BACKEND', 'false');

    expect(shouldUseCanonicalBackendPath('batches')).toBe(true);
  });

  it('keeps rollback shim disabled unless explicitly enabled', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_PARITY_ACCEPTED_WORKFLOWS', 'batches');

    expect(shouldUseTypescriptRollbackShim('batches')).toBe(false);
  });

  it('re-enables rollback shim for accepted workflows when rollback flags are enabled', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_PARITY_ACCEPTED_WORKFLOWS', 'batches,tasks');
    vi.stubEnv('VITE_ENABLE_TYPESCRIPT_ROLLBACK_SHIMS', 'true');
    vi.stubEnv('VITE_TYPESCRIPT_ROLLBACK_WORKFLOWS', 'batches');

    expect(shouldUseTypescriptRollbackShim('batches')).toBe(true);
    expect(shouldUseTypescriptRollbackShim('tasks')).toBe(false);
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
});
