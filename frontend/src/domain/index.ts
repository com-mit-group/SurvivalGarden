import type { Batch, BatchStageEvent } from '../contracts';

export const createUuid = (): string => crypto.randomUUID();

export const buildTaskSourceKey = (
  batchId: string,
  date: string,
  cropId: string,
  bedId: string,
  type: string,
): string => [batchId, date, cropId, bedId, type].join('_').toLowerCase();

const BATCH_STAGE_TRANSITIONS: Record<string, readonly string[]> = {
  sowing: ['transplant', 'harvest', 'failed'],
  transplant: ['harvest', 'failed'],
  harvest: ['ended', 'failed'],
  failed: ['ended'],
  ended: ['failed'],
};

export type BatchTransitionReason = 'invalid_stage_transition' | 'stage_event_stage_mismatch';

type BatchTransitionSuccess = {
  ok: true;
  batch: Batch;
};

type BatchTransitionFailure = {
  ok: false;
  reason: BatchTransitionReason;
};

export type BatchTransitionResult = BatchTransitionSuccess | BatchTransitionFailure;

export const canTransition = (currentStage: string, nextStage: string): boolean => {
  if (nextStage === 'failed') {
    return true;
  }

  if (nextStage === 'ended') {
    return currentStage === 'harvest' || currentStage === 'failed';
  }

  return BATCH_STAGE_TRANSITIONS[currentStage]?.includes(nextStage) ?? false;
};

export const applyStageEvent = (batch: Batch, event: BatchStageEvent): BatchTransitionResult => {
  if (event.stage !== batch.stage && !canTransition(batch.stage, event.stage)) {
    return { ok: false, reason: 'invalid_stage_transition' };
  }

  return {
    ok: true,
    batch: {
      ...batch,
      stage: event.stage,
      stageEvents: [...batch.stageEvents, event],
    },
  };
};
