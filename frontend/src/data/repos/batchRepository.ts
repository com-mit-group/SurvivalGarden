import type { AppState, Batch } from '../../contracts';
import { applyStageEvent } from '../../domain';
import { assertValid } from '../validation';
import type { BatchListFilter, ListQuery } from './interfaces';

const normalizeBatchCandidate = (value: unknown): unknown => value ?? {};

type BatchAssignmentWithRange = Batch['assignments'][number] & {
  fromDate?: string;
  toDate?: string | null;
};

const getAssignmentFromDate = (assignment: BatchAssignmentWithRange): string => assignment.fromDate ?? assignment.assignedAt;

const getAssignmentToDate = (assignment: BatchAssignmentWithRange): string | null => assignment.toDate ?? null;

export const getActiveBedAssignment = (
  batch: Batch,
  onDate: string,
): BatchAssignmentWithRange | null => {
  let activeAssignment: BatchAssignmentWithRange | null = null;

  for (const assignment of batch.assignments as BatchAssignmentWithRange[]) {
    const fromDate = getAssignmentFromDate(assignment);
    const toDate = getAssignmentToDate(assignment);

    if (fromDate > onDate) {
      continue;
    }

    if (toDate && toDate < onDate) {
      continue;
    }

    if (!activeAssignment || getAssignmentFromDate(activeAssignment) <= fromDate) {
      activeAssignment = assignment;
    }
  }

  return activeAssignment;
};

const getDerivedBedId = (batch: Batch, onDate: string): string | null => getActiveBedAssignment(batch, onDate)?.bedId ?? null;

export const getBatchFromAppState = (
  appState: unknown,
  batchId: Batch['batchId'],
): Batch | null => {
  const state = assertValid('appState', appState);
  const candidate = state.batches.find((batch) => batch.batchId === batchId);

  if (!candidate) {
    return null;
  }

  return assertValid('batch', normalizeBatchCandidate(candidate));
};

export const listBatchesFromAppState = (
  appState: unknown,
  query: ListQuery<BatchListFilter> = {},
): Batch[] => {
  const state = assertValid('appState', appState);
  const { filter } = query;
  const onDate = new Date().toISOString();

  return state.batches
    .filter((batch) => {
      if (!filter) {
        return true;
      }

      if (filter.stage && batch.stage !== filter.stage) {
        return false;
      }

      if (filter.cropId && batch.cropId !== filter.cropId) {
        return false;
      }

      if (filter.bedId && getDerivedBedId(batch, onDate) !== filter.bedId) {
        return false;
      }

      if (filter.startedAtFrom && batch.startedAt < filter.startedAtFrom) {
        return false;
      }

      if (filter.startedAtTo && batch.startedAt > filter.startedAtTo) {
        return false;
      }

      return true;
    })
    .map((batch) => assertValid('batch', normalizeBatchCandidate(batch)));
};

export const upsertBatchInAppState = (appState: unknown, batch: unknown): AppState => {
  const state = assertValid('appState', appState);
  const validBatch = assertValid('batch', normalizeBatchCandidate(batch));
  const existingIndex = state.batches.findIndex((entry) => entry.batchId === validBatch.batchId);

  if (existingIndex >= 0) {
    const existingBatch = state.batches[existingIndex]!;

    if (existingBatch.stage !== validBatch.stage) {
      const latestStageEvent = validBatch.stageEvents[validBatch.stageEvents.length - 1];

      if (!latestStageEvent || latestStageEvent.stage !== validBatch.stage) {
        throw new Error('stage_event_stage_mismatch');
      }

      const transition = applyStageEvent(existingBatch, latestStageEvent);

      if (!transition.ok) {
        throw new Error(transition.reason);
      }
    }
  }

  const batches =
    existingIndex >= 0
      ? state.batches.map((entry, index) => (index === existingIndex ? validBatch : entry))
      : [...state.batches, validBatch];

  return assertValid('appState', { ...state, batches });
};

export const removeBatchFromAppState = (appState: unknown, batchId: Batch['batchId']): AppState => {
  const state = assertValid('appState', appState);
  const batches = state.batches.filter((batch) => batch.batchId !== batchId);
  return assertValid('appState', { ...state, batches });
};
