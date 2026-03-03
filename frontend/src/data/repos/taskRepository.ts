import type { AppState, Task } from '../../contracts';
import { expandTaskRuleWindowsToLocalDates } from '../../domain';
import { getActiveBedAssignment } from './batchRepository';
import { assertValid } from '../validation';
import type { ListQuery } from './interfaces';

const normalizeTaskCandidate = (value: unknown): unknown => value ?? {};

const asChecklistEntry = (entry: unknown): Record<string, unknown> =>
  typeof entry === 'object' && entry !== null ? { ...(entry as Record<string, unknown>) } : {};

const toChecklistIdentity = (entry: Record<string, unknown>): string => {
  if (typeof entry.step === 'string') {
    return `step:${entry.step}`;
  }

  if (typeof entry.label === 'string') {
    return `label:${entry.label}`;
  }

  return JSON.stringify(
    Object.fromEntries(
      Object.entries(entry).filter(
        ([key]) => key !== 'done' && key !== 'completed' && key !== 'status',
      ),
    ),
  );
};

const mergeGeneratedChecklist = (
  existingChecklist: Record<string, unknown>[],
  generatedChecklist: Record<string, unknown>[],
): Record<string, unknown>[] => {
  const existingByIdentity = new Map(
    existingChecklist.map((entry) => {
      const normalized = asChecklistEntry(entry);
      return [toChecklistIdentity(normalized), normalized] as const;
    }),
  );

  const merged = generatedChecklist.map((entry) => {
    const normalized = asChecklistEntry(entry);
    const identity = toChecklistIdentity(normalized);
    const existingEntry = existingByIdentity.get(identity);

    if (!existingEntry) {
      return normalized;
    }

    return {
      ...normalized,
      ...(typeof existingEntry.done === 'boolean' ? { done: existingEntry.done } : {}),
      ...(typeof existingEntry.completed === 'boolean' ? { completed: existingEntry.completed } : {}),
      ...(typeof existingEntry.status === 'string' ? { status: existingEntry.status } : {}),
    };
  });

  const generatedIdentities = new Set(merged.map(toChecklistIdentity));
  const userAddedEntries = existingChecklist
    .map(asChecklistEntry)
    .filter((entry) => !generatedIdentities.has(toChecklistIdentity(entry)));

  return [...merged, ...userAddedEntries];
};

export const getTaskFromAppState = (appState: unknown, taskId: Task['id']): Task | null => {
  const state = assertValid('appState', appState);
  const candidate = state.tasks.find((task) => task.id === taskId);

  if (!candidate) {
    return null;
  }

  return assertValid('task', normalizeTaskCandidate(candidate));
};

export const listTasksFromAppState = (
  appState: unknown,
  query: ListQuery<Pick<Task, 'date' | 'status'>> = {},
): Task[] => {
  const state = assertValid('appState', appState);
  const { filter } = query;

  return state.tasks
    .filter((task) => {
      if (!filter) {
        return true;
      }

      if (filter.date && task.date !== filter.date) {
        return false;
      }

      if (filter.status && task.status !== filter.status) {
        return false;
      }

      return true;
    })
    .map((task) => assertValid('task', normalizeTaskCandidate(task)));
};

export const upsertTaskInAppState = (appState: unknown, task: unknown): AppState => {
  const state = assertValid('appState', appState);
  const validTask = assertValid('task', normalizeTaskCandidate(task));
  const existingIndex = state.tasks.findIndex((entry) => entry.id === validTask.id);

  const tasks =
    existingIndex >= 0
      ? state.tasks.map((entry, index) => (index === existingIndex ? validTask : entry))
      : [...state.tasks, validTask];

  return assertValid('appState', { ...state, tasks });
};

export const removeTaskFromAppState = (appState: unknown, taskId: Task['id']): AppState => {
  const state = assertValid('appState', appState);
  const tasks = state.tasks.filter((task) => task.id !== taskId);
  return assertValid('appState', { ...state, tasks });
};

export const upsertGeneratedTasksInAppState = (
  appState: unknown,
  generatedTasks: unknown[],
): AppState => {
  const state = assertValid('appState', appState);
  const existingTasksBySourceKey = new Map(state.tasks.map((task) => [task.sourceKey, task]));
  const mergedTasksBySourceKey = new Map(state.tasks.map((task) => [task.sourceKey, task]));

  for (const generatedTask of generatedTasks) {
    const validGeneratedTask = assertValid('task', generatedTask);
    const existingTask = existingTasksBySourceKey.get(validGeneratedTask.sourceKey);

    mergedTasksBySourceKey.set(
      validGeneratedTask.sourceKey,
      existingTask
        ? {
            ...validGeneratedTask,
            status: existingTask.status,
            checklist: mergeGeneratedChecklist(existingTask.checklist, validGeneratedTask.checklist),
          }
        : validGeneratedTask,
    );
  }

  return assertValid('appState', {
    ...state,
    tasks: [...mergedTasksBySourceKey.values()],
  });
};

const buildPlannedTaskSourceKey = (
  year: number,
  bedId: string,
  cropId: string,
  successionIndex: number,
  taskType: string,
  windowIndex: number,
): string =>
  ['plan', year, bedId, cropId, successionIndex, taskType, windowIndex]
    .join('_')
    .toLowerCase();

const toTaskType = (taskType: string): string => taskType.replace(/_/g, '-');

const toIsoDate = (isoDateTime: string): string => isoDateTime.slice(0, 10);

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const sortStageEvents = (events: AppState['batches'][number]['stageEvents']) =>
  events
    .map((event, index) => ({ ...event, index }))
    .sort((left, right) =>
      left.occurredAt === right.occurredAt
        ? left.index - right.index
        : left.occurredAt.localeCompare(right.occurredAt),
    );

const selectLatestStageEvent = (
  events: AppState['batches'][number]['stageEvents'],
  ...stageNames: string[]
) => {
  const normalizedStageNames = new Set(stageNames.map((stageName) => stageName.toLowerCase()));
  const matchingEvents = sortStageEvents(events).filter((event) => normalizedStageNames.has(event.stage.toLowerCase()));
  return matchingEvents.length > 0 ? matchingEvents[matchingEvents.length - 1] : null;
};

const buildOperationalTaskSourceKey = (
  batchId: string,
  taskType: string,
  anchorOccurredAt: string,
  stageEventIndex: number,
): string => ['batch', batchId, taskType, anchorOccurredAt, stageEventIndex].join('_').toLowerCase();

export const generatePlannedTasks = (appState: unknown, year: number): Task[] => {
  const state = assertValid('appState', appState);
  const cropsById = new Map(state.crops.map((crop) => [crop.cropId, crop]));
  const sortedPlans = [...state.cropPlans]
    .filter((plan) => plan.seasonYear === year && typeof plan.bedId === 'string' && plan.bedId.length > 0)
    .sort((left, right) =>
      left.bedId === right.bedId
        ? left.cropId === right.cropId
          ? left.planId.localeCompare(right.planId)
          : left.cropId.localeCompare(right.cropId)
        : left.bedId!.localeCompare(right.bedId!),
    );

  const successionIndexByPlanId = new Map<string, number>();
  const successionCounters = new Map<string, number>();

  for (const plan of sortedPlans) {
    const key = `${plan.bedId}:${plan.cropId}`;
    const nextIndex = (successionCounters.get(key) ?? -1) + 1;
    successionCounters.set(key, nextIndex);
    successionIndexByPlanId.set(plan.planId, nextIndex);
  }

  const plannedTasks: Task[] = [];

  for (const plan of sortedPlans) {
    const crop = cropsById.get(plan.cropId);

    if (!crop || !crop.taskRules || crop.taskRules.length === 0 || !plan.bedId) {
      continue;
    }

    const sortedTaskRules = [...crop.taskRules].sort((left, right) =>
      left.sequence === right.sequence
        ? left.taskType.localeCompare(right.taskType)
        : left.sequence - right.sequence,
    );

    const successionIndex = successionIndexByPlanId.get(plan.planId);

    if (typeof successionIndex !== 'number') {
      continue;
    }

    for (const taskRule of sortedTaskRules) {
      const windowsWithIndex = taskRule.windows.map((window, windowIndex) => ({ window, windowIndex }));

      for (const { window, windowIndex } of windowsWithIndex) {
        const [date] = expandTaskRuleWindowsToLocalDates([window], year);

        if (!date) {
          continue;
        }

        const sourceKey = buildPlannedTaskSourceKey(
          year,
          plan.bedId,
          plan.cropId,
          successionIndex,
          taskRule.taskType,
          windowIndex,
        );

        plannedTasks.push({
          id: sourceKey,
          sourceKey,
          date,
          type: toTaskType(taskRule.taskType),
          cropId: plan.cropId,
          bedId: plan.bedId,
          batchId: `planned_${year}_${plan.bedId}_${plan.cropId}_${successionIndex}`.toLowerCase(),
          checklist: [],
          status: 'pending',
        });
      }
    }
  }

  return plannedTasks.sort((left, right) =>
    left.date === right.date
      ? left.sourceKey.localeCompare(right.sourceKey)
      : left.date.localeCompare(right.date),
  );
};

export const generateOperationalTasks = (appState: unknown): Task[] => {
  const state = assertValid('appState', appState);
  const cropsById = new Map(state.crops.map((crop) => [crop.cropId, crop]));
  const generatedTasks: Task[] = [];

  for (const batch of state.batches) {
    const preSown = selectLatestStageEvent(batch.stageEvents, 'pre_sown', 'sowing');
    const germinated = selectLatestStageEvent(batch.stageEvents, 'germinated');
    const transplant = selectLatestStageEvent(batch.stageEvents, 'transplant');
    const harvest = selectLatestStageEvent(batch.stageEvents, 'harvest');
    const crop = cropsById.get(batch.cropId);

    const pushTask = (taskType: string, date: string, anchorOccurredAt: string, stageEventIndex: number) => {
      const sourceKey = buildOperationalTaskSourceKey(batch.batchId, taskType, anchorOccurredAt, stageEventIndex);
      const bedId = getActiveBedAssignment(batch, `${date}T23:59:59.999Z`)?.bedId ?? 'unassigned';
      generatedTasks.push({
        id: sourceKey,
        sourceKey,
        date,
        type: taskType,
        cropId: batch.cropId,
        bedId,
        batchId: batch.batchId,
        checklist: [],
        status: 'pending',
      });
    };

    if (preSown) {
      const anchorDate = toIsoDate(preSown.occurredAt);
      pushTask('germination-check', addDays(anchorDate, 7), preSown.occurredAt, preSown.index);
      pushTask('germination-check', addDays(anchorDate, 14), preSown.occurredAt, preSown.index + 1);
    }

    if (germinated) {
      pushTask('pot-up', addDays(toIsoDate(germinated.occurredAt), 7), germinated.occurredAt, germinated.index);
    }

    if (transplant) {
      const transplantDate = toIsoDate(transplant.occurredAt);
      pushTask('harden-off', addDays(transplantDate, -7), transplant.occurredAt, transplant.index);
      pushTask('harden-off', addDays(transplantDate, -2), transplant.occurredAt, transplant.index + 1);
      pushTask('bed-assignment', transplantDate, transplant.occurredAt, transplant.index + 2);

      const harvestWindowDates = crop?.taskRules
        ?.filter((rule) => rule.taskType === 'harvest')
        .flatMap((rule) => expandTaskRuleWindowsToLocalDates(rule.windows, Number.parseInt(transplantDate.slice(0, 4), 10)))
        .sort();

      if (harvestWindowDates && harvestWindowDates.length > 0) {
        const firstAfterTransplant =
          harvestWindowDates.find((date) => date >= transplantDate) ??
          harvestWindowDates[0] ??
          addDays(transplantDate, 60);
        pushTask('harvest-reminder', firstAfterTransplant, transplant.occurredAt, transplant.index + 3);
      } else {
        pushTask('harvest-reminder', addDays(transplantDate, 60), transplant.occurredAt, transplant.index + 3);
      }
    } else if (harvest) {
      pushTask('harvest-reminder', toIsoDate(harvest.occurredAt), harvest.occurredAt, harvest.index);
    }
  }

  return generatedTasks.sort((left, right) =>
    left.date === right.date
      ? left.sourceKey.localeCompare(right.sourceKey)
      : left.date.localeCompare(right.date),
  );
};
