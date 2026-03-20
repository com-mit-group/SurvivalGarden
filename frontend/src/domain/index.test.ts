import { describe, expect, it } from 'vitest';
import type { Batch } from '../contracts';
import { applyStageEvent, canTransition, expandTaskRuleWindowsToLocalDates, inferBatchStartMethod } from './index';

declare global {
  interface ImportMeta {
    glob: (
      pattern: string,
      options?: { eager?: boolean; import?: string },
    ) => Record<string, unknown>;
  }
}

const realBatchFixtures = import.meta.glob('../../../fixtures/real/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, { batches?: Array<Record<string, unknown>> }>;

describe('expandTaskRuleWindowsToLocalDates', () => {
  it('returns deterministic local dates for mixed window formats', () => {
    const windows = [
      { startDate: '2026-03-01', endDate: '2026-03-11' },
      { month: 4, weekIndex: 2 },
      { month: 4, weekIndex: 2 },
    ];

    const first = expandTaskRuleWindowsToLocalDates(windows, 2026);
    const second = expandTaskRuleWindowsToLocalDates(windows, 2026);

    expect(first).toEqual(['2026-03-06', '2026-04-08']);
    expect(second).toEqual(first);
  });

  it('clamps out-of-range month week selections deterministically', () => {
    expect(expandTaskRuleWindowsToLocalDates([{ month: 2, weekIndex: 5 }], 2026)).toEqual([
      '2026-02-22',
    ]);
  });
});


describe('migrated batch start methods', () => {
  it('accepts representative migrated and supported creation start methods without rewriting their stored method', () => {
    const realFixture = realBatchFixtures['../../../fixtures/real/actual-batches-vnext-2026-03-07.json'];
    const migratedLettuceBatch = realFixture?.batches?.find((batch) => batch.batchId === 'batch-lettuce-2026-03-06-01');
    const migratedBasilBatch = realFixture?.batches?.find((batch) => batch.batchId === 'batch-basil-genoveser-2026-01');
    const migratedRegrowBatch = realFixture?.batches?.find((batch) => batch.batchId === 'celery-regrow-2026-02-20-01');

    expect(migratedLettuceBatch).toBeDefined();
    expect(migratedBasilBatch).toBeDefined();
    expect(migratedRegrowBatch).toBeDefined();

    const cases = [
      {
        batchStage: 'sowing',
        eventStage: 'sowing',
        nextStage: 'transplant',
        rawMethod: 'paper_towel',
        expectedMethod: 'pre_sow_paper_towel',
        inferredStage: 'pre_sown',
      },
      {
        batchStage: 'sowing',
        eventStage: 'sowing',
        nextStage: 'transplant',
        rawMethod: 'pre_sow_indoor',
        expectedMethod: 'pre_sow_indoor',
        inferredStage: 'pre_sown',
      },
      {
        batchStage: 'sowing',
        eventStage: 'sowing',
        nextStage: 'transplant',
        rawMethod: 'direct_sow',
        expectedMethod: 'direct_sow',
        inferredStage: 'sowing',
      },
      {
        batchStage: 'sowing',
        eventStage: 'sowing',
        nextStage: 'transplant',
        rawMethod: 'sow_indoor',
        expectedMethod: 'sow_indoor',
        inferredStage: 'sowing',
      },
      {
        batchStage: 'started',
        eventStage: 'started',
        nextStage: 'transplant',
        rawMethod: 'regrow_water',
        expectedMethod: 'regrow_water',
        inferredStage: 'started',
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const batch: Batch = {
        batchId: `batch-${index + 1}`,
        cropId: 'crop-1',
        startedAt: '2026-03-01T00:00:00Z',
        stage: testCase.batchStage,
        stageEvents: [],
        assignments: [],
      };

      expect(canTransition(testCase.batchStage, testCase.nextStage)).toBe(true);
      expect(inferBatchStartMethod(testCase.inferredStage, testCase.rawMethod)).toBe(testCase.expectedMethod);

      const result = applyStageEvent(batch, {
        stage: testCase.eventStage,
        occurredAt: '2026-03-01T00:00:00Z',
        method: testCase.rawMethod,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.batch.stageEvents[0]).toMatchObject({
          stage: testCase.batchStage,
          method: testCase.expectedMethod,
        });
      }
    }
  });
});
