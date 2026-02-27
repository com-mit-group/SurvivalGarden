import type { AppState, Batch } from '../../contracts';
import { assertValid } from '../validation';
import type { BatchListFilter, ListQuery } from './interfaces';

const normalizeBatchCandidate = (value: unknown): unknown => value ?? {};

const getDerivedBedId = (batch: Batch): string | null => {
  if (batch.assignments.length === 0) {
    return null;
  }

  const latestAssignment = batch.assignments.reduce((latest, assignment) =>
    assignment.assignedAt > latest.assignedAt ? assignment : latest,
  );

  return latestAssignment.bedId;
};

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

      if (filter.bedId && getDerivedBedId(batch) !== filter.bedId) {
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
