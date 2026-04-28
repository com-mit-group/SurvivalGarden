import type { AppState, Batch, Bed, Crop, CropPlan, SeedInventoryItem, Segment, Species } from '../contracts';
import { assertValid } from './validation';
import type { SchemaName, SchemaTypeMap } from './validation';
import type { BackendApiPath } from '../generated/api-client';

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

const backendPath = (path: BackendApiPath): string => path;

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

const isEmergencyTypescriptRollbackEnabled = (feature: WorkflowFeature): boolean => {
  const env = resolveRuntimeEnv();
  if (!isFeatureFlagEnabled(env.VITE_ENABLE_EMERGENCY_TYPESCRIPT_ROLLBACK)) {
    return false;
  }

  const rollbackFeatures = parseWorkflowList(env.VITE_EMERGENCY_TYPESCRIPT_ROLLBACK_WORKFLOWS);
  return rollbackFeatures.length === 0 || rollbackFeatures.includes(feature);
};

export const isCutoverCompleteWorkflow = (feature: WorkflowFeature): boolean => {
  if (!isParityAcceptedWorkflow(feature)) {
    return false;
  }

  const env = resolveRuntimeEnv();
  return parseWorkflowList(env.VITE_CUTOVER_COMPLETE_WORKFLOWS).includes(feature);
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
 * @deprecated Rollback-only helper. Remove alongside rollback retirement target (2026-07-31).
 */
export const shouldUseTypescriptRollbackShim = (feature: WorkflowFeature): boolean => {
  if (isEmergencyTypescriptRollbackEnabled(feature)) {
    return true;
  }

  if (isCutoverCompleteWorkflow(feature)) {
    return false;
  }

  return !shouldUseCanonicalBackendPath(feature) || isTypescriptRollbackShimEnabled(feature);
};

export const parseBackendError = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json() as {
      error?: unknown;
      errors?: Array<{ path?: unknown; message?: unknown }>;
    };

    if (payload && typeof payload.error === 'string') {
      return payload.error;
    }

    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      const summary = payload.errors
        .slice(0, 5)
        .map((issue) => {
          const path = typeof issue.path === 'string' ? issue.path : '/';
          const message = typeof issue.message === 'string' ? issue.message : 'invalid';
          return `${path}: ${message}`;
        })
        .join('; ');
      return `validation_failed: ${summary}`;
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


const buildContractMismatchError = (contractName: string, error: unknown): Error => {
  const details = error instanceof Error ? `: ${error.message}` : '';
  return new Error(`Backend contract mismatch for ${contractName}${details}`);
};

const assertContract = <T extends SchemaName>(contractName: string, schemaName: T, payload: unknown): SchemaTypeMap[T] => {
  try {
    return assertValid(schemaName, payload);
  } catch (error) {
    throw buildContractMismatchError(contractName, error);
  }
};

const assertContractList = <T extends SchemaName>(
  contractName: string,
  schemaName: T,
  payload: unknown,
): SchemaTypeMap[T][] => {
  if (!Array.isArray(payload)) {
    throw buildContractMismatchError(contractName, new Error('expected array payload'));
  }

  return payload.map((item, index) => assertContract(`${contractName}[${index}]`, schemaName, item));
};

type ImportSummary = {
  imported: number;
  merged: number;
  skipped: number;
  rejected: number;
};

type ImportIssue = {
  path: string;
  message: string;
};

type ImportCommandResult = {
  summary: ImportSummary;
  errors: ImportIssue[];
};

type CultivarRecord = {
  cultivarId: string;
  cropTypeId: string;
  name: string;
  supplier?: string;
  source?: string;
  year?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

const assertImportSummary = (contractName: string, payload: unknown): ImportSummary => {
  if (!payload || typeof payload !== 'object') {
    throw buildContractMismatchError(contractName, new Error('expected object payload'));
  }

  const summary = payload as Record<string, unknown>;
  const getNumber = (key: keyof ImportSummary): number => {
    const value = summary[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw buildContractMismatchError(contractName, new Error(`expected numeric ${key}`));
    }
    return value;
  };

  return {
    imported: getNumber('imported'),
    merged: getNumber('merged'),
    skipped: getNumber('skipped'),
    rejected: getNumber('rejected'),
  };
};

const assertImportIssues = (contractName: string, payload: unknown): ImportIssue[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw buildContractMismatchError(contractName, new Error(`errors[${index}] must be an object`));
    }

    const issue = entry as Record<string, unknown>;
    if (typeof issue.path !== 'string' || typeof issue.message !== 'string') {
      throw buildContractMismatchError(contractName, new Error(`errors[${index}] must include string path/message`));
    }

    return { path: issue.path, message: issue.message };
  });
};

const assertImportCommandResult = (contractName: string, payload: unknown): ImportCommandResult => {
  if (!payload || typeof payload !== 'object') {
    throw buildContractMismatchError(contractName, new Error('expected object payload'));
  }

  const typedPayload = payload as Record<string, unknown>;
  return {
    summary: assertImportSummary(`${contractName}.summary`, typedPayload.summary),
    errors: assertImportIssues(`${contractName}.errors`, typedPayload.errors),
  };
};

export const workflowAdapter = {
  appState: {
    replace: async (appState: AppState): Promise<void> => {
      const response = await fetch(toBackendApiUrl('/api/app-state'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appState),
      });

      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
    },
  },
  batches: {
    upsertBatch: async (batch: Batch): Promise<Batch> =>
      assertContract('batches.upsertBatch', 'batch', await fetchJson<unknown>('/api/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      })),
    importBatches: async (batches: Batch[]): Promise<ImportCommandResult> =>
      assertImportCommandResult('batches.importBatches', await fetchJson<unknown>('/api/import/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batches }),
      })),
    transitionStage: async (batchId: string, nextStage: string, occurredAt: string): Promise<Batch> =>
      fetchJson<Batch>(`/api/batches/${encodeURIComponent(batchId)}/stage-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: nextStage, occurredAt }),
      }),
    mutateAssignment: async (
      operation: 'assign' | 'move' | 'remove',
      payload: { batchId: string; bedId?: string; at: string },
    ): Promise<Batch> =>
      fetchJson<Batch>(
        operation === 'assign'
          ? `/api/batches/${encodeURIComponent(payload.batchId)}/assign-bed`
          : operation === 'move'
            ? `/api/batches/${encodeURIComponent(payload.batchId)}/move-bed`
            : `/api/batches/${encodeURIComponent(payload.batchId)}/unassign-bed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bedId: payload.bedId, at: payload.at }),
        },
      ),
    removeBatch: async (batchId: string): Promise<void> => {
      const response = await fetch(toBackendApiUrl(`/api/batches/${encodeURIComponent(batchId)}`), { method: 'DELETE' });
      if (response.status === 404 || response.status === 204) {
        return;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
    },
  },
  tasks: {
    upsertTask: async (task: AppState['tasks'][number]): Promise<AppState['tasks'][number]> =>
      assertContract('tasks.upsertTask', 'task', await fetchJson<unknown>(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      })),
    regenerateCalendar: async (year: number): Promise<{
      generatedTasks: AppState['tasks'];
      diagnostics: { cropId: string; reason: string; detail: string }[];
      stateAfter: AppState;
    }> => {
      const payload = await fetchJson<{
        generatedTasks: AppState['tasks'];
        diagnostics?: { cropId: string; reason: string; detail: string }[];
        stateAfter: AppState;
      }>(backendPath('/api/domain/tasks/regenerate-calendar'), {
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
    listBeds: async (): Promise<Bed[]> =>
      assertContractList('bedsSegments.listBeds', 'bed', await fetchJson<unknown>(backendPath('/api/beds'), { method: 'GET' })),
    getBed: async (bedId: string): Promise<Bed | null> => {
      const response = await fetch(toBackendApiUrl(`/api/beds/${encodeURIComponent(bedId)}`), { method: 'GET' });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
      return assertContract('bedsSegments.getBed', 'bed', await response.json());
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
    listSegments: async (): Promise<Segment[]> =>
      assertContractList('bedsSegments.listSegments', 'segment', await fetchJson<unknown>(backendPath('/api/segments'), { method: 'GET' })),
    getSegment: async (segmentId: string): Promise<Segment | null> => {
      const response = await fetch(toBackendApiUrl(`/api/segments/${encodeURIComponent(segmentId)}`), { method: 'GET' });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
      return assertContract('bedsSegments.getSegment', 'segment', await response.json());
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
    importSegments: async (segments: Segment[]): Promise<ImportCommandResult> =>
      assertImportCommandResult('bedsSegments.importSegments', await fetchJson<unknown>('/api/import/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments }),
      })),
  },
  taxonomy: {
    listCultivars: async (): Promise<CultivarRecord[]> =>
      fetchJson<CultivarRecord[]>(backendPath('/api/cultivars'), { method: 'GET' }),
    upsertCultivar: async (cultivar: CultivarRecord): Promise<CultivarRecord> =>
      fetchJson<CultivarRecord>(`/api/cultivars/${encodeURIComponent(cultivar.cultivarId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cultivar),
      }),
    removeCultivar: async (cultivarId: string): Promise<void> => {
      const response = await fetch(toBackendApiUrl(`/api/cultivars/${encodeURIComponent(cultivarId)}`), { method: 'DELETE' });
      if (response.status === 404 || response.status === 204) {
        return;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
    },
    listSpecies: async (): Promise<Species[]> =>
      assertContractList('taxonomy.listSpecies', 'species', await fetchJson<unknown>(backendPath('/api/species'), { method: 'GET' })),
    getSpecies: async (speciesId: string): Promise<Species | null> => {
      const response = await fetch(toBackendApiUrl(`/api/species/${encodeURIComponent(speciesId)}`), { method: 'GET' });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
      return assertContract('taxonomy.getSpecies', 'species', await response.json());
    },
    upsertSpecies: async (species: Species): Promise<Species> =>
      assertContract('taxonomy.upsertSpecies', 'species', await fetchJson<unknown>(`/api/species/${encodeURIComponent(species.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(species),
      })),
    removeSpecies: async (speciesId: string): Promise<void> => {
      const response = await fetch(toBackendApiUrl(`/api/species/${encodeURIComponent(speciesId)}`), { method: 'DELETE' });
      if (response.status === 404 || response.status === 204) {
        return;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
    },
    listCrops: async (): Promise<Crop[]> =>
      assertContractList('taxonomy.listCrops', 'crop', await fetchJson<unknown>(backendPath('/api/crops'), { method: 'GET' })),
    getCrop: async (cropId: string): Promise<Crop | null> => {
      const response = await fetch(toBackendApiUrl(`/api/crops/${encodeURIComponent(cropId)}`), { method: 'GET' });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
      return assertContract('taxonomy.getCrop', 'crop', await response.json());
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
    listCropPlans: async (): Promise<CropPlan[]> =>
      assertContractList('taxonomy.listCropPlans', 'cropPlan', await fetchJson<unknown>(backendPath('/api/cropPlans'), { method: 'GET' })),
    getCropPlan: async (planId: string): Promise<CropPlan | null> => {
      const response = await fetch(toBackendApiUrl(`/api/cropPlans/${encodeURIComponent(planId)}`), { method: 'GET' });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(await parseBackendError(response));
      }
      return assertContract('taxonomy.getCropPlan', 'cropPlan', await response.json());
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
    importSpecies: async (species: Species[]): Promise<ImportCommandResult> =>
      assertImportCommandResult('taxonomy.importSpecies', await fetchJson<unknown>('/api/import/species', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ species }),
      })),
    importCrops: async (crops: Crop[]): Promise<ImportCommandResult> =>
      assertImportCommandResult('taxonomy.importCrops', await fetchJson<unknown>('/api/import/crops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crops }),
      })),
    importCropPlans: async (cropPlans: CropPlan[]): Promise<ImportCommandResult> =>
      assertImportCommandResult('taxonomy.importCropPlans', await fetchJson<unknown>('/api/import/crop-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cropPlans }),
      })),
  },
  inventory: {
    listSeedInventoryItems: async (): Promise<SeedInventoryItem[]> =>
      assertContractList(
        'inventory.listSeedInventoryItems',
        'seedInventoryItem',
        await fetchJson<unknown>(backendPath('/api/seedInventoryItems'), { method: 'GET' }),
      ),
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
      return assertContract('inventory.getSeedInventoryItem', 'seedInventoryItem', await response.json());
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
