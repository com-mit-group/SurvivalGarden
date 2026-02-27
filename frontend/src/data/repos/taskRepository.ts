import type { AppState, Task } from '../../contracts';
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
