import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isCutoverCompleteWorkflow,
  isWorkflowRoutedToBackend,
  shouldUseCanonicalBackendPath,
  shouldUseTypescriptRollbackShim,
  toBackendApiUrl,
  workflowAdapter,
} from './workflowAdapter';

const originalFetch = globalThis.fetch;


const validBed = {
  bedId: 'bed-1',
  gardenId: 'garden-1',
  name: 'Bed 1',
  type: 'vegetable_bed',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
};

const validSegment = {
  segmentId: 'segment-1',
  name: 'Segment 1',
  width: 10,
  height: 5,
  originReference: 'nw_corner',
  beds: [{ ...validBed, x: 0, y: 0, width: 2, height: 1 }],
  paths: [],
};

const validCrop = {
  cropId: 'crop-1',
  name: 'Carrot',
  speciesId: 'species_carrot',
  scientificName: 'Daucus carota',
  aliases: ['Garden carrot', 'Nantes carrot'],
  isUserDefined: true,
  category: 'root',
  companionsGood: ['onion'],
  companionsAvoid: ['dill'],
  rules: {
    sowing: {
      sequence: 1,
      windows: [{ startMonth: 3, startWeek: 2, endMonth: 4, endWeek: 3 }],
      notes: 'Direct sow',
    },
    transplant: {
      sequence: 2,
      windows: [{ startMonth: 4, startWeek: 4, endMonth: 5, endWeek: 2 }],
      notes: 'Thin as needed',
    },
    harvest: {
      sequence: 3,
      windows: [{ startMonth: 6, startWeek: 1, endMonth: 9, endWeek: 4 }],
      notes: 'Pull when ready',
    },
    storage: {
      sequence: 4,
      windows: [{ startMonth: 9, startWeek: 1, endMonth: 12, endWeek: 4 }],
      notes: 'Cool and humid',
    },
  },
  nutritionProfile: [{ nutrient: 'fiber', value: 2.8, unit: 'g', source: 'USDA', assumptions: 'raw' }],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
};

const validCropPlan = {
  planId: 'plan-1',
  segmentId: 'segment-1',
  cropId: 'crop-1',
  bedId: 'bed-1',
  seasonYear: 2024,
  plannedWindows: {
    sowing: [{ startMonth: 3, startWeek: 2, endMonth: 4, endWeek: 3 }],
    harvest: [{ startMonth: 6, startWeek: 1, endMonth: 9, endWeek: 4 }],
  },
  expectedYield: {
    amount: 12,
    unit: 'kg',
  },
  notes: 'Main spring bed',
  placements: [{ type: 'points', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }] }],
};

const validSeedInventoryItem = {
  seedInventoryItemId: 'seed-item-1',
  cultivarId: 'cultivar-1',
  cropId: 'crop-1',
  variety: 'Nantes',
  quantity: 120,
  unit: 'seeds',
  status: 'available',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
};

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
  it('throws an explicit configuration error in backend mode when backend base URL is missing', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_BACKEND_API_BASE_URL', undefined as unknown as string);

    expect(() => toBackendApiUrl('/api/beds')).toThrowError('VITE_BACKEND_API_BASE_URL must be set in backend mode');
  });

  it('returns an absolute backend URL in backend mode when backend base URL is configured', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_BACKEND_API_BASE_URL', 'http://localhost:5142');

    expect(toBackendApiUrl('/api/beds')).toBe('http://localhost:5142/api/beds');
  });

  it('leaves typescript mode paths unchanged when backend base URL is missing', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'typescript');
    vi.stubEnv('VITE_BACKEND_API_BASE_URL', undefined as unknown as string);

    expect(toBackendApiUrl('/api/beds')).toBe('/api/beds');
  });

  it('posts stage transitions to the backend batch endpoint', async () => {
    vi.stubEnv('VITE_BACKEND_API_BASE_URL', 'http://localhost:5142');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ batchId: 'batch-1', stage: 'harvest' }),
    } as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    const batch = await workflowAdapter.batches.transitionStage('batch-1', 'harvest', '2026-04-01T00:00:00Z');

    expect(batch.batchId).toBe('batch-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5142/api/batches/batch-1/stage-events',
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


  it('validates high-impact backend payloads and returns typed values when valid', async () => {
    vi.stubEnv('VITE_BACKEND_API_BASE_URL', 'http://localhost:5142');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [validBed] } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => validBed } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [validSegment] } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => validSegment } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [validCrop] } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => validCrop } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [validCropPlan] } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => validCropPlan } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [validSeedInventoryItem] } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => validSeedInventoryItem } as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(workflowAdapter.bedsSegments.listBeds()).resolves.toEqual([validBed]);
    await expect(workflowAdapter.bedsSegments.getBed(validBed.bedId)).resolves.toEqual(validBed);
    await expect(workflowAdapter.bedsSegments.listSegments()).resolves.toEqual([validSegment]);
    await expect(workflowAdapter.bedsSegments.getSegment(validSegment.segmentId)).resolves.toEqual(validSegment);
    await expect(workflowAdapter.taxonomy.listCrops()).resolves.toEqual([validCrop]);
    await expect(workflowAdapter.taxonomy.getCrop(validCrop.cropId)).resolves.toEqual(validCrop);
    await expect(workflowAdapter.taxonomy.listCropPlans()).resolves.toEqual([validCropPlan]);
    await expect(workflowAdapter.taxonomy.getCropPlan(validCropPlan.planId)).resolves.toEqual(validCropPlan);
    await expect(workflowAdapter.inventory.listSeedInventoryItems()).resolves.toEqual([validSeedInventoryItem]);
    await expect(workflowAdapter.inventory.getSeedInventoryItem(validSeedInventoryItem.seedInventoryItemId)).resolves.toEqual(validSeedInventoryItem);
  });

  it('throws explicit contract mismatch errors when backend payload shape is invalid', async () => {
    vi.stubEnv('VITE_BACKEND_API_BASE_URL', 'http://localhost:5142');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ bedId: 'bed-1' }] } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ bedId: 'bed-1' }) } as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(workflowAdapter.bedsSegments.listBeds()).rejects.toThrowError(
      /Backend contract mismatch for bedsSegments\.listBeds\[0\]/,
    );
    await expect(workflowAdapter.bedsSegments.getBed('bed-1')).rejects.toThrowError(
      /Backend contract mismatch for bedsSegments\.getBed/,
    );
  });

  it('preserves existing status/error handling semantics for high-impact get methods', async () => {
    vi.stubEnv('VITE_BACKEND_API_BASE_URL', 'http://localhost:5142');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 404, ok: false } as Response)
      .mockResolvedValueOnce({
        status: 422,
        ok: false,
        json: async () => ({ errors: [{ path: '/cropId', message: 'required' }] }),
      } as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(workflowAdapter.taxonomy.getCrop('missing-crop')).resolves.toBeNull();
    await expect(workflowAdapter.taxonomy.getCrop('invalid-crop')).rejects.toThrowError(
      'validation_failed: /cropId: required',
    );
  });

  it('calls canonical backend endpoints for dynamic resource operations', async () => {
    vi.stubEnv('VITE_BACKEND_API_BASE_URL', 'http://localhost:5142');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bedId: 'bed%201' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cropId: 'crop%201' }) } as Response)
      .mockResolvedValueOnce({ status: 204, ok: true } as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    await workflowAdapter.bedsSegments.upsertBed({
      bedId: 'bed 1',
      name: 'Bed 1',
      type: 'vegetable_bed',
      gardenId: 'garden-1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    await workflowAdapter.taxonomy.upsertCrop({
      cropId: 'crop 1',
      name: 'Potato',
      speciesId: 'species_potato',
      companionsGood: [],
      companionsAvoid: [],
      rules: {
        sowing: { sequence: 1, windows: [] },
        transplant: { sequence: 1, windows: [] },
        harvest: { sequence: 1, windows: [] },
        storage: { sequence: 1, windows: [] },
      },
      nutritionProfile: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    await workflowAdapter.inventory.removeSeedInventoryItem('seed item 1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:5142/api/beds/bed%201',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:5142/api/crops/crop%201',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:5142/api/seedInventoryItems/seed%20item%201',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
