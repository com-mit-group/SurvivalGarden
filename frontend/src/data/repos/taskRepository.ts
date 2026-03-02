import type { AppState, Task } from '../../contracts';
import { expandTaskRuleWindowsToLocalDates } from '../../domain';
import { assertValid } from '../validation';
import type { ListQuery } from './interfaces';

const normalizeTaskCandidate = (value: unknown): unknown => value ?? {};

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
