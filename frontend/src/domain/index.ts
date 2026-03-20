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
  started: ['transplant', 'harvest', 'failed'],
  transplant: ['harvest', 'failed'],
  harvest: ['ended', 'failed'],
  failed: ['ended'],
  ended: ['failed'],
};

const LEGACY_STAGE_ALIASES: Record<string, string> = {
  pre_sown: 'sowing',
};

const LEGACY_START_METHOD_ALIASES: Record<string, string> = {
  paper_towel: 'pre_sow_paper_towel',
  tray: 'pre_sow_indoor',
  indoor: 'sow_indoor',
  direct: 'direct_sow',
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

export const normalizeBatchStage = (stage: string): string => LEGACY_STAGE_ALIASES[stage] ?? stage;

export const normalizeBatchStartMethod = (method: string | undefined): string | undefined =>
  method ? LEGACY_START_METHOD_ALIASES[method] ?? method : undefined;

export const inferBatchStartMethod = (
  stage: string | undefined,
  method?: string,
): string | undefined => normalizeBatchStartMethod(method) ?? (stage === 'pre_sown' ? 'pre_sow_paper_towel' : undefined);

export const canTransition = (currentStage: string, nextStage: string): boolean => {
  const normalizedCurrentStage = normalizeBatchStage(currentStage);
  const normalizedNextStage = normalizeBatchStage(nextStage);
  if (normalizedNextStage === 'failed') {
    return true;
  }

  if (normalizedNextStage === 'ended') {
    return normalizedCurrentStage === 'harvest' || normalizedCurrentStage === 'failed';
  }

  return BATCH_STAGE_TRANSITIONS[normalizedCurrentStage]?.includes(normalizedNextStage) ?? false;
};

export const applyStageEvent = (batch: Batch, event: BatchStageEvent): BatchTransitionResult => {
  const normalizedBatchStage = normalizeBatchStage(batch.stage);
  const normalizedEventStage = normalizeBatchStage(event.stage);
  const normalizedEventMethod = normalizeBatchStartMethod(event.method);

  if (normalizedEventStage !== normalizedBatchStage && !canTransition(normalizedBatchStage, normalizedEventStage)) {
    return { ok: false, reason: 'invalid_stage_transition' };
  }

  return {
    ok: true,
    batch: {
      ...batch,
      stage: normalizedEventStage,
      currentStage: normalizedEventStage,
      stageEvents: [
        ...batch.stageEvents,
        {
          ...event,
          stage: normalizedEventStage,
          ...(normalizedEventMethod ? { method: normalizedEventMethod } : {}),
        },
      ],
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
