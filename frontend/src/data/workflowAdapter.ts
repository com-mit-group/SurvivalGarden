import type { AppState, Batch } from '../contracts';

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

export const toBackendApiUrl = (path: string): string => `${getBackendApiBaseUrl()}${path}`;

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
};
