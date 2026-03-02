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

export type TaskRuleDateRangeWindow = {
  startDate: string;
  endDate: string;
};

export type TaskRuleMonthWeekWindow = {
  month: number;
  weekIndex: number;
};

export type TaskRuleWindow = TaskRuleDateRangeWindow | TaskRuleMonthWeekWindow;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const toUtcDate = (localDate: string): Date => {
  const parsed = LOCAL_DATE_PATTERN.exec(localDate);

  if (!parsed) {
    throw new Error(`Invalid local date: ${localDate}`);
  }

  const [, year, month, day] = parsed;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
};

const toLocalDate = (date: Date): string => date.toISOString().slice(0, 10);

const expandDateRangeWindowToLocalDate = (window: TaskRuleDateRangeWindow): string => {
  const start = toUtcDate(window.startDate);
  const end = toUtcDate(window.endDate);

  if (end.getTime() <= start.getTime()) {
    return window.startDate;
  }

  const midpointTime = start.getTime() + Math.floor((end.getTime() - start.getTime()) / 2);
  return toLocalDate(new Date(midpointTime));
};

const expandMonthWeekWindowToLocalDate = (window: TaskRuleMonthWeekWindow, year: number): string => {
  const daysInMonth = new Date(Date.UTC(year, window.month, 0)).getUTCDate();
  const maxWeekIndex = Math.ceil(daysInMonth / 7);
  const clampedWeekIndex = Math.min(Math.max(window.weekIndex, 1), maxWeekIndex);
  const day = 1 + (clampedWeekIndex - 1) * 7;

  return toLocalDate(new Date(Date.UTC(year, window.month - 1, day)));
};

export const expandTaskRuleWindowsToLocalDates = (windows: TaskRuleWindow[], year: number): string[] => {
  const dates = windows.map((window) =>
    'startDate' in window
      ? expandDateRangeWindowToLocalDate(window)
      : expandMonthWeekWindowToLocalDate(window, year),
  );

  return [...new Set(dates)].sort();
};
