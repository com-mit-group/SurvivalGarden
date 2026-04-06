import type { AppState, Batch, Bed, Crop, CropPlan, SeedInventoryItem, Segment } from '../contracts';

export type WorkflowFeature = 'batches' | 'tasks' | 'bedsSegments' | 'taxonomy' | 'inventory';

const DEFAULT_BACKEND_API_BASE_URL = '';

const resolveRuntimeEnv = (): Record<string, string | undefined> => {
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (processEnv) {
    return processEnv;
  }

  const importMetaEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  if (importMetaEnv) {
    return importMetaEnv;
  }

  return {};
};

export const getBackendApiBaseUrl = (): string => {
  const env = resolveRuntimeEnv();
  return (env.VITE_BACKEND_API_BASE_URL ?? DEFAULT_BACKEND_API_BASE_URL).trim().replace(/\/$/, '');
};

const validateBackendApiPath = (path: string, baseUrl: string): void => {
  if (getFrontendMode() === 'backend' && path.startsWith('/') && baseUrl.length === 0) {
    throw new Error('VITE_BACKEND_API_BASE_URL must be set in backend mode');
  }
};

export const toBackendApiUrl = (path: string): string => {
  const baseUrl = getBackendApiBaseUrl();
  validateBackendApiPath(path, baseUrl);

  if (baseUrl.length === 0) {
    return path;
  }

  return new URL(path, `${baseUrl}/`).toString();
};

const isFeatureFlagEnabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === 'true';
const parseWorkflowList = (value: string | undefined): WorkflowFeature[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is WorkflowFeature =>
      entry === 'batches' || entry === 'tasks' || entry === 'bedsSegments' || entry === 'taxonomy' || entry === 'inventory',
    );

export const getFrontendMode = (): 'typescript' | 'backend' => {
  const env = resolveRuntimeEnv();
  return env.VITE_FRONTEND_MODE?.trim().toLowerCase() === 'backend' ? 'backend' : 'typescript';
};

const workflowFlagByFeature: Record<WorkflowFeature, string> = {
  batches: 'VITE_ROUTE_BATCHES_TO_BACKEND',
  tasks: 'VITE_ROUTE_TASKS_TO_BACKEND',
  bedsSegments: 'VITE_ROUTE_BEDS_SEGMENTS_TO_BACKEND',
  taxonomy: 'VITE_ROUTE_TAXONOMY_TO_BACKEND',
  inventory: 'VITE_ROUTE_INVENTORY_TO_BACKEND',
};

export const isWorkflowRoutedToBackend = (feature: WorkflowFeature): boolean => {
  if (getFrontendMode() !== 'backend') {
    return false;
  }

  const env = resolveRuntimeEnv();
  return isFeatureFlagEnabled(env[workflowFlagByFeature[feature]]);
};

const isParityAcceptedWorkflow = (feature: WorkflowFeature): boolean => {
  const env = resolveRuntimeEnv();
  return parseWorkflowList(env.VITE_PARITY_ACCEPTED_WORKFLOWS).includes(feature);
};

const isTypescriptRollbackShimEnabled = (feature: WorkflowFeature): boolean => {
  const env = resolveRuntimeEnv();
  if (!isFeatureFlagEnabled(env.VITE_ENABLE_TYPESCRIPT_ROLLBACK_SHIMS)) {
    return false;
  }

  const rollbackFeatures = parseWorkflowList(env.VITE_TYPESCRIPT_ROLLBACK_WORKFLOWS);
  return rollbackFeatures.length === 0 || rollbackFeatures.includes(feature);
};

export const shouldUseCanonicalBackendPath = (feature: WorkflowFeature): boolean => {
  if (getFrontendMode() !== 'backend') {
    return false;
  }

  if (isParityAcceptedWorkflow(feature)) {
    return true;
  }

  return isWorkflowRoutedToBackend(feature);
};

/**
 * @deprecated Rollback-only helper. Remove alongside VITE_ENABLE_TYPESCRIPT_ROLLBACK_SHIMS retirement.
 */
export const shouldUseTypescriptRollbackShim = (feature: WorkflowFeature): boolean =>
  !shouldUseCanonicalBackendPath(feature) || isTypescriptRollbackShimEnabled(feature);

export const parseBackendError = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json();
    if (payload && typeof payload.error === 'string') {
      return payload.error;
    }
  } catch {
    // ignore parse issues; fall back to status text
  }

  return `${response.status} ${response.statusText}`;
};

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(toBackendApiUrl(path), init);

  if (!response.ok) {
    throw new Error(await parseBackendError(response));
  }

  return response.json() as Promise<T>;
};

export const workflowAdapter = {
  batches: {
    transitionStage: async (batchId: string, nextStage: string, occurredAt: string): Promise<Batch> =>
      fetchJson<Batch>(`/api/domain/batches/${encodeURIComponent(batchId)}/stage-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: nextStage, occurredAt }),
      }),
    mutateAssignment: async (
      operation: 'assign' | 'move' | 'remove',
      payload: { batchId: string; bedId?: string; at: string },
    ): Promise<Batch> =>
      fetchJson<Batch>(`/api/domain/batches/${encodeURIComponent(payload.batchId)}/assignment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, bedId: payload.bedId, at: payload.at }),
      }),
  },
  tasks: {
    regenerateCalendar: async (year: number): Promise<{
      generatedTasks: AppState['tasks'];
      diagnostics: { cropId: string; reason: string; detail: string }[];
      stateAfter: AppState;
    }> => {
      const payload = await fetchJson<{
        generatedTasks: AppState['tasks'];
        diagnostics?: { cropId: string; reason: string; detail: string }[];
        stateAfter: AppState;
      }>('/api/domain/tasks/regenerate-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year }),
      });

      return {
        generatedTasks: payload.generatedTasks,
        diagnostics: payload.diagnostics ?? [],
        stateAfter: payload.stateAfter,
      };
    },
  },
  bedsSegments: {
    listBeds: async (): Promise<Bed[]> => fetchJson<Bed[]>('/api/beds', { method: 'GET' }),
    getBed: async (bedId: string): Promise<Bed | null> => {
      const response = await fetch(toBackendApiUrl(`/api/beds/${encodeURIComponent(bedId)}`), { method: 'GET' });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
      return response.json() as Promise<Bed>;
    },
    upsertBed: async (bed: Bed): Promise<Bed> =>
      fetchJson<Bed>(`/api/beds/${encodeURIComponent(bed.bedId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bed),
      }),
    removeBed: async (bedId: string): Promise<void> => {
      const response = await fetch(toBackendApiUrl(`/api/beds/${encodeURIComponent(bedId)}`), { method: 'DELETE' });
      if (response.status === 404 || response.status === 204) {
        return;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
    },
    listSegments: async (): Promise<Segment[]> => fetchJson<Segment[]>('/api/segments', { method: 'GET' }),
    getSegment: async (segmentId: string): Promise<Segment | null> => {
      const response = await fetch(toBackendApiUrl(`/api/segments/${encodeURIComponent(segmentId)}`), { method: 'GET' });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
      return response.json() as Promise<Segment>;
    },
    upsertSegment: async (segment: Segment): Promise<Segment> =>
      fetchJson<Segment>(`/api/segments/${encodeURIComponent(segment.segmentId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(segment),
      }),
    removeSegment: async (segmentId: string): Promise<void> => {
      const response = await fetch(toBackendApiUrl(`/api/segments/${encodeURIComponent(segmentId)}`), { method: 'DELETE' });
      if (response.status === 404 || response.status === 204) {
        return;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
    },
  },
  taxonomy: {
    listCrops: async (): Promise<Crop[]> => fetchJson<Crop[]>('/api/crops', { method: 'GET' }),
    getCrop: async (cropId: string): Promise<Crop | null> => {
      const response = await fetch(toBackendApiUrl(`/api/crops/${encodeURIComponent(cropId)}`), { method: 'GET' });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
      return response.json() as Promise<Crop>;
    },
    upsertCrop: async (crop: Crop): Promise<Crop> =>
      fetchJson<Crop>(`/api/crops/${encodeURIComponent(crop.cropId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(crop),
      }),
    removeCrop: async (cropId: string): Promise<void> => {
      const response = await fetch(toBackendApiUrl(`/api/crops/${encodeURIComponent(cropId)}`), { method: 'DELETE' });
      if (response.status === 404 || response.status === 204) {
        return;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
    },
    listCropPlans: async (): Promise<CropPlan[]> => fetchJson<CropPlan[]>('/api/cropPlans', { method: 'GET' }),
    getCropPlan: async (planId: string): Promise<CropPlan | null> => {
      const response = await fetch(toBackendApiUrl(`/api/cropPlans/${encodeURIComponent(planId)}`), { method: 'GET' });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
      return response.json() as Promise<CropPlan>;
    },
    upsertCropPlan: async (cropPlan: CropPlan): Promise<CropPlan> =>
      fetchJson<CropPlan>(`/api/cropPlans/${encodeURIComponent(cropPlan.planId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cropPlan),
      }),
    removeCropPlan: async (planId: string): Promise<void> => {
      const response = await fetch(toBackendApiUrl(`/api/cropPlans/${encodeURIComponent(planId)}`), { method: 'DELETE' });
      if (response.status === 404 || response.status === 204) {
        return;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
    },
  },
  inventory: {
    listSeedInventoryItems: async (): Promise<SeedInventoryItem[]> =>
      fetchJson<SeedInventoryItem[]>('/api/seedInventoryItems', { method: 'GET' }),
    getSeedInventoryItem: async (seedInventoryItemId: string): Promise<SeedInventoryItem | null> => {
      const response = await fetch(
        toBackendApiUrl(`/api/seedInventoryItems/${encodeURIComponent(seedInventoryItemId)}`),
        { method: 'GET' },
      );
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
      return response.json() as Promise<SeedInventoryItem>;
    },
    upsertSeedInventoryItem: async (seedInventoryItem: SeedInventoryItem): Promise<SeedInventoryItem> =>
      fetchJson<SeedInventoryItem>(`/api/seedInventoryItems/${encodeURIComponent(seedInventoryItem.seedInventoryItemId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedInventoryItem),
      }),
    removeSeedInventoryItem: async (seedInventoryItemId: string): Promise<void> => {
      const response = await fetch(
        toBackendApiUrl(`/api/seedInventoryItems/${encodeURIComponent(seedInventoryItemId)}`),
        { method: 'DELETE' },
      );
      if (response.status === 404 || response.status === 204) {
        return;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
    },
  },
};
