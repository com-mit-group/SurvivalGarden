import { afterEach, describe, expect, it, vi } from 'vitest';
import { mutateBatchAssignment, regenerateCalendarTasks, transitionBatchStage } from './index';

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

const stubCutoverCompleteEnv = () => {
  vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
  vi.stubEnv('VITE_PARITY_ACCEPTED_WORKFLOWS', 'batches,tasks');
  vi.stubEnv('VITE_CUTOVER_COMPLETE_WORKFLOWS', 'batches,tasks');
};

const failingBackendResponse = {
  ok: false,
  status: 500,
  statusText: 'Internal Server Error',
  json: async () => {
    throw new Error('no-json');
  },
} as Response;

describe('cutover-complete workflow mutation routing', () => {
  it('never executes local batch stage mutation shims for cutover-complete workflows', async () => {
    stubCutoverCompleteEnv();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(failingBackendResponse);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(transitionBatchStage('batch-1', 'harvest', '2026-04-01T00:00:00Z')).rejects.toThrow('500 Internal Server Error');

    expect(warnSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never executes local batch assignment mutation shims for cutover-complete workflows', async () => {
    stubCutoverCompleteEnv();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(failingBackendResponse);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      mutateBatchAssignment('assign', {
        batchId: 'batch-1',
        bedId: 'bed-1',
        at: '2026-04-01T00:00:00Z',
      }),
    ).rejects.toThrow('500 Internal Server Error');

    expect(warnSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never executes local task derivation shims for cutover-complete workflows', async () => {
    stubCutoverCompleteEnv();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(failingBackendResponse);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(regenerateCalendarTasks(2026)).rejects.toThrow('500 Internal Server Error');

    expect(warnSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
