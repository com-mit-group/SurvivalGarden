import { describe, expect, it } from 'vitest';
import type { AppState, Task } from '../../contracts';
import {
  generateOperationalTasks,
  generatePlannedTasks,
  upsertGeneratedTasksInAppState,
} from './taskRepository';

const goldenFixtures = import.meta.glob('../../../../fixtures/golden/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

const trierFixture = goldenFixtures['../../../../fixtures/golden/trier-v1.json'] as AppState;

const createGenerationScenario = (): AppState => ({
  ...trierFixture,
  tasks: [],
  batches: [
    {
      batchId: 'batch-alpha',
      cropId: 'crop_potato',
      startedAt: '2026-03-01T00:00:00Z',
      stage: 'transplant',
      stageEvents: [
        { stage: 'pre_sown', occurredAt: '2026-03-01T00:00:00Z' },
        { stage: 'germinated', occurredAt: '2026-03-10T00:00:00Z' },
        { stage: 'transplant', occurredAt: '2026-04-15T00:00:00Z' },
      ],
      assignments: [
        { bedId: 'bed_001', assignedAt: '2026-03-01T00:00:00Z' },
        { bedId: 'bed_002', assignedAt: '2026-04-10T00:00:00Z' },
      ],
    },
    {
      batchId: 'batch-beta',
      cropId: 'crop_carrot',
      startedAt: '2026-02-01T00:00:00Z',
      stage: 'harvest',
      stageEvents: [
        { stage: 'pre_sown', occurredAt: '2026-02-01T00:00:00Z' },
        { stage: 'harvest', occurredAt: '2026-06-20T00:00:00Z' },
      ],
      assignments: [{ bedId: 'bed_004', assignedAt: '2026-02-01T00:00:00Z' }],
    },
  ],
});

const mulberry32 = (seed: number) => {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffleWithSeed = <T>(items: T[], seed: number): T[] => {
  const random = mulberry32(seed);
  const output = [...items];

  for (let index = output.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(random() * (index + 1));
    const currentItem = output[index]!;
    const nextItem = output[nextIndex]!;

    output[index] = nextItem;
    output[nextIndex] = currentItem;
  }

  return output;
};

const generateAllTasks = (appState: AppState): Task[] => [
  ...generatePlannedTasks(appState, 2026),
  ...generateOperationalTasks(appState),
];

const normalizeTask = (task: Task) => ({
  sourceKey: task.sourceKey,
  id: task.id,
  date: task.date,
  type: task.type,
  cropId: task.cropId,
  bedId: task.bedId,
  batchId: task.batchId,
  status: task.status,
  checklist: [...task.checklist]
    .map((entry) => JSON.parse(JSON.stringify(entry)) as Record<string, unknown>)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
});

const normalizeTasks = (tasks: Task[]) =>
  tasks
    .map(normalizeTask)
    .sort((left, right) =>
      left.sourceKey === right.sourceKey
        ? left.date.localeCompare(right.date)
        : left.sourceKey.localeCompare(right.sourceKey),
    );

const sourceKeys = (tasks: Task[]) => tasks.map((task) => task.sourceKey).sort();

const byTypeAndStatusCount = (tasks: Task[]) => {
  const countByTypeAndStatus: Record<string, number> = {};

  for (const task of tasks) {
    const key = `${task.type}:${task.status}`;
    countByTypeAndStatus[key] = (countByTypeAndStatus[key] ?? 0) + 1;
  }

  return countByTypeAndStatus;
};

describe('taskRepository generation idempotence', () => {
  it('keeps generated/upserted outputs stable across repeated regenerations', () => {
    const scenario = createGenerationScenario();
    const initialGenerated = generateAllTasks(scenario);
    let currentState: AppState = { ...scenario, tasks: [] };

    for (let i = 0; i < 5; i += 1) {
      currentState = upsertGeneratedTasksInAppState(currentState, generateAllTasks(scenario));
    }

    expect(initialGenerated.every((task) => typeof task.sourceKey === 'string' && task.sourceKey.length > 0)).toBe(true);
    expect(sourceKeys(currentState.tasks)).toEqual(sourceKeys(initialGenerated));
    expect(normalizeTasks(currentState.tasks)).toEqual(normalizeTasks(initialGenerated));
    expect(new Set(sourceKeys(currentState.tasks)).size).toBe(currentState.tasks.length);
  });

  it('remains stable under deterministic input-order perturbations', () => {
    const baselineScenario = createGenerationScenario();
    const baselineMerged = upsertGeneratedTasksInAppState(
      { ...baselineScenario, tasks: [] },
      generateAllTasks(baselineScenario),
    );

    for (const seed of [11, 37, 91]) {
      const perturbedScenario: AppState = {
        ...baselineScenario,
        cropPlans: shuffleWithSeed(baselineScenario.cropPlans, seed),
        batches: shuffleWithSeed(baselineScenario.batches, seed + 1).map((batch) => ({
          ...batch,
          stageEvents: shuffleWithSeed(batch.stageEvents, seed + 2),
          assignments: shuffleWithSeed(batch.assignments, seed + 3),
        })),
        tasks: shuffleWithSeed(baselineScenario.tasks, seed + 4),
      };

      const perturbedMerged = upsertGeneratedTasksInAppState(
        { ...perturbedScenario, tasks: [] },
        generateAllTasks(perturbedScenario),
      );

      expect(sourceKeys(perturbedMerged.tasks)).toEqual(sourceKeys(baselineMerged.tasks));
      expect(normalizeTasks(perturbedMerged.tasks)).toEqual(normalizeTasks(baselineMerged.tasks));
    }
  });

  it('prevents duplicate source keys and preserves type/status distributions after many passes', () => {
    const scenario = createGenerationScenario();
    const baselineMerged = upsertGeneratedTasksInAppState({ ...scenario, tasks: [] }, generateAllTasks(scenario));
    let regenerated = { ...scenario, tasks: [] } as AppState;

    for (let pass = 0; pass < 8; pass += 1) {
      regenerated = upsertGeneratedTasksInAppState(regenerated, generateAllTasks(scenario));
    }

    const keys = sourceKeys(regenerated.tasks);
    expect(new Set(keys).size).toBe(keys.length);
    expect(regenerated.tasks).toHaveLength(baselineMerged.tasks.length);
    expect(byTypeAndStatusCount(regenerated.tasks)).toEqual(byTypeAndStatusCount(baselineMerged.tasks));
  });
});
