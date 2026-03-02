import type { AppState, Batch } from '../../contracts';
import { applyStageEvent } from '../../domain';
import { assertValid } from '../validation';
import type { BatchListFilter, ListQuery } from './interfaces';

const normalizeBatchCandidate = (value: unknown): unknown => value ?? {};

type BatchAssignmentWithRange = Batch['assignments'][number] & {
  fromDate?: string;
  toDate?: string | null;
};

type AssignBatchMeta = {
  move?: boolean;
};

const getAssignmentFromDate = (assignment: BatchAssignmentWithRange): string => assignment.fromDate ?? assignment.assignedAt;

const getAssignmentToDate = (assignment: BatchAssignmentWithRange): string | null => assignment.toDate ?? null;

const isDateWithinAssignmentWindow = (assignment: BatchAssignmentWithRange, onDate: string): boolean => {
  const fromDate = getAssignmentFromDate(assignment);
  const toDate = getAssignmentToDate(assignment);

  if (fromDate > onDate) {
    return false;
  }

  if (toDate && toDate < onDate) {
    return false;
  }

  return true;
};

const assignmentsOverlap = (
  left: BatchAssignmentWithRange,
  rightFromDate: string,
  rightToDate: string | null,
): boolean => {
  const leftFromDate = getAssignmentFromDate(left);
  const leftToDate = getAssignmentToDate(left);
  const leftToBoundary = leftToDate ?? '9999-12-31T23:59:59.999Z';
  const rightToBoundary = rightToDate ?? '9999-12-31T23:59:59.999Z';

  return leftFromDate <= rightToBoundary && rightFromDate <= leftToBoundary;
};

export const assignBatchToBed = (
  batch: Batch,
  bedId: string,
  fromDate: string,
  meta?: AssignBatchMeta,
): Batch => {
  const validBatch = batch;
  const assignments = validBatch.assignments as BatchAssignmentWithRange[];
  const incomingToDate: string | null = null;

  const hasSameBedActiveAssignment = assignments.some(
    (assignment) => assignment.bedId === bedId && isDateWithinAssignmentWindow(assignment, fromDate),
  );

  if (hasSameBedActiveAssignment) {
    return validBatch;
  }

  if (!meta?.move) {
    const hasOverlapConflict = assignments.some((assignment) => assignmentsOverlap(assignment, fromDate, incomingToDate));

    if (hasOverlapConflict) {
      throw new Error('batch_assignment_overlap');
    }
  }

  const nextAssignment = {
    bedId,
    assignedAt: fromDate,
    fromDate,
  } as Batch['assignments'][number];

  return {
    ...validBatch,
    assignments: [...validBatch.assignments, nextAssignment],
  };
};

export const getActiveBedAssignment = (
  batch: Batch,
  onDate: string,
): BatchAssignmentWithRange | null => {
  let activeAssignment: BatchAssignmentWithRange | null = null;

  for (const assignment of batch.assignments as BatchAssignmentWithRange[]) {
    if (!isDateWithinAssignmentWindow(assignment, onDate)) {
      continue;
    }

    const fromDate = getAssignmentFromDate(assignment);

    if (!activeAssignment || getAssignmentFromDate(activeAssignment) <= fromDate) {
      activeAssignment = assignment;
    }
  }

  return activeAssignment;
};

export const moveBatch = (
  batch: Batch,
  newBedId: string,
  moveDate: string,
  _meta?: AssignBatchMeta,
): Batch => {
  void _meta;
  const activeAssignment = getActiveBedAssignment(batch, moveDate);

  if (!activeAssignment) {
    throw new Error('batch_assignment_no_active');
  }

  const activeFromDate = getAssignmentFromDate(activeAssignment);

  if (moveDate < activeFromDate) {
    throw new Error('batch_assignment_move_before_start');
  }

  if (activeAssignment.bedId === newBedId) {
    return batch;
  }

  const updatedAssignments = (batch.assignments as BatchAssignmentWithRange[]).map((assignment) => {
    if (assignment !== activeAssignment) {
      return assignment;
    }

    return {
      ...assignment,
      toDate: moveDate,
    };
  });

  const nextAssignment = {
    bedId: newBedId,
    assignedAt: moveDate,
    fromDate: moveDate,
  } as Batch['assignments'][number];

  return {
    ...batch,
    assignments: [...updatedAssignments, nextAssignment],
  };
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
