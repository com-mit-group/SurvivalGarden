import { describe, expect, it } from 'vitest';
import type { Batch } from '../../contracts';
import {
  assignBatchToBed,
  getActiveBedAssignment,
  getBatchFromAppState,
  listBatchesFromAppState,
  moveBatch,
  normalizeBatchesWithReport,
  removeBatchFromBed,
} from './batchRepository';

const createBatch = (assignments: Array<{ bedId: string; assignedAt: string; fromDate?: string; toDate?: string | null }>): Batch =>
  ({
    batchId: 'batch-1',
    cropId: 'crop-1',
    startedAt: '2026-01-01T00:00:00Z',
    stage: 'sowing',
    stageEvents: [{ stage: 'sowing', occurredAt: '2026-01-01T00:00:00Z' }],
    assignments: assignments as Batch['assignments'],
  });

describe('getActiveBedAssignment', () => {
  it('returns assignment when onDate equals fromDate', () => {
    const batch = createBatch([{ bedId: 'bed-1', assignedAt: '2026-02-01T00:00:00Z', fromDate: '2026-02-01T00:00:00Z' }]);

    expect(getActiveBedAssignment(batch, '2026-02-01T00:00:00Z')?.bedId).toBe('bed-1');
  });

  it('treats toDate as inclusive', () => {
    const batch = createBatch([
      {
        bedId: 'bed-2',
        assignedAt: '2026-02-01T00:00:00Z',
        fromDate: '2026-02-01T00:00:00Z',
        toDate: '2026-02-10T00:00:00Z',
      },
    ]);

    expect(getActiveBedAssignment(batch, '2026-02-10T00:00:00Z')?.bedId).toBe('bed-2');
  });

  it('returns null before start date', () => {
    const batch = createBatch([{ bedId: 'bed-3', assignedAt: '2026-03-01T00:00:00Z', fromDate: '2026-03-01T00:00:00Z' }]);

    expect(getActiveBedAssignment(batch, '2026-02-28T23:59:59Z')).toBeNull();
  });

  it('returns null after end date', () => {
    const batch = createBatch([
      {
        bedId: 'bed-4',
        assignedAt: '2026-03-01T00:00:00Z',
        fromDate: '2026-03-01T00:00:00Z',
        toDate: '2026-03-05T00:00:00Z',
      },
    ]);

    expect(getActiveBedAssignment(batch, '2026-03-05T00:00:01Z')).toBeNull();
  });

  it('supports open-ended assignments', () => {
    const batch = createBatch([{ bedId: 'bed-5', assignedAt: '2026-04-01T00:00:00Z', fromDate: '2026-04-01T00:00:00Z' }]);

    expect(getActiveBedAssignment(batch, '2027-01-01T00:00:00Z')?.bedId).toBe('bed-5');
  });

  it('uses latest active fromDate when multiple assignments overlap', () => {
    const batch = createBatch([
      {
        bedId: 'bed-6',
        assignedAt: '2026-05-01T00:00:00Z',
        fromDate: '2026-05-01T00:00:00Z',
        toDate: '2026-05-30T00:00:00Z',
      },
      {
        bedId: 'bed-7',
        assignedAt: '2026-05-10T00:00:00Z',
        fromDate: '2026-05-10T00:00:00Z',
        toDate: '2026-05-25T00:00:00Z',
      },
    ]);

    expect(getActiveBedAssignment(batch, '2026-05-15T00:00:00Z')?.bedId).toBe('bed-7');
  });
});

describe('assignBatchToBed', () => {
  it('appends a new assignment when there is no overlap', () => {
    const batch = createBatch([
      {
        bedId: 'bed-1',
        assignedAt: '2026-01-01T00:00:00Z',
        fromDate: '2026-01-01T00:00:00Z',
        toDate: '2026-01-31T23:59:59Z',
      },
    ]);

    const updated = assignBatchToBed(batch, 'bed-2', '2026-02-01T00:00:00Z');

    expect(updated.assignments).toHaveLength(2);
    expect(updated.assignments[1]).toMatchObject({
      bedId: 'bed-2',
      assignedAt: '2026-02-01T00:00:00Z',
      fromDate: '2026-02-01T00:00:00Z',
    });
  });

  it('rejects overlapping assignment when move flag is not set', () => {
    const batch = createBatch([
      {
        bedId: 'bed-1',
        assignedAt: '2026-01-01T00:00:00Z',
        fromDate: '2026-01-01T00:00:00Z',
      },
    ]);

    expect(() => assignBatchToBed(batch, 'bed-2', '2026-01-15T00:00:00Z')).toThrowError('batch_assignment_overlap');
  });

  it('returns unchanged batch when already active on same bed', () => {
    const batch = createBatch([
      {
        bedId: 'bed-1',
        assignedAt: '2026-01-01T00:00:00Z',
        fromDate: '2026-01-01T00:00:00Z',
      },
    ]);

    const updated = assignBatchToBed(batch, 'bed-1', '2026-01-20T00:00:00Z');

    expect(updated).toBe(batch);
  });

  it('allows overlapping assignment when move flag is set', () => {
    const batch = createBatch([
      {
        bedId: 'bed-1',
        assignedAt: '2026-01-01T00:00:00Z',
        fromDate: '2026-01-01T00:00:00Z',
      },
    ]);

    const updated = assignBatchToBed(batch, 'bed-2', '2026-01-15T00:00:00Z', { move: true });

    expect(updated.assignments).toHaveLength(2);
    expect(updated.assignments[1]).toMatchObject({ bedId: 'bed-2' });
  });
});


describe('moveBatch', () => {
  it('closes current assignment and leaves exactly one active assignment after move date', () => {
    const batch = createBatch([
      {
        bedId: 'bed-1',
        assignedAt: '2026-01-01T00:00:00Z',
        fromDate: '2026-01-01T00:00:00Z',
      },
    ]);

    const moved = moveBatch(batch, 'bed-2', '2026-01-15T00:00:00Z');

    expect(moved.assignments).toHaveLength(2);
    expect(moved.assignments[0]).toMatchObject({
      bedId: 'bed-1',
      toDate: '2026-01-15T00:00:00Z',
    });
    expect(moved.assignments[1]).toMatchObject({
      bedId: 'bed-2',
      assignedAt: '2026-01-15T00:00:00Z',
      fromDate: '2026-01-15T00:00:00Z',
    });
    expect(getActiveBedAssignment(moved, '2026-01-16T00:00:00Z')?.bedId).toBe('bed-2');
  });

  it('throws when there is no active assignment at move date', () => {
    const batch = createBatch([
      {
        bedId: 'bed-1',
        assignedAt: '2026-01-01T00:00:00Z',
        fromDate: '2026-01-01T00:00:00Z',
        toDate: '2026-01-05T00:00:00Z',
      },
    ]);

    expect(() => moveBatch(batch, 'bed-2', '2026-01-10T00:00:00Z')).toThrowError('batch_assignment_no_active');
  });

  it('throws when move date is earlier than active assignment fromDate', () => {
    const batch = createBatch([
      {
        bedId: 'bed-1',
        assignedAt: '2026-01-01T00:00:00Z',
        fromDate: '2026-01-10T00:00:00Z',
      },
    ]);

    expect(() => moveBatch(batch, 'bed-2', '2026-01-09T00:00:00Z')).toThrowError('batch_assignment_no_active');
  });
});


describe('removeBatchFromBed', () => {
  it('closes active assignment and leaves no active assignment after end date', () => {
    const batch = createBatch([
      {
        bedId: 'bed-1',
        assignedAt: '2026-01-01T00:00:00Z',
        fromDate: '2026-01-01T00:00:00Z',
      },
    ]);

    const updated = removeBatchFromBed(batch, '2026-01-15T00:00:00Z');

    expect(updated.assignments).toHaveLength(1);
    expect(updated.assignments[0]).toMatchObject({
      bedId: 'bed-1',
      toDate: '2026-01-15T00:00:00Z',
    });
    expect(getActiveBedAssignment(updated, '2026-01-15T00:00:01Z')).toBeNull();
  });

  it('returns unchanged batch when already unassigned at end date', () => {
    const batch = createBatch([
      {
        bedId: 'bed-1',
        assignedAt: '2026-01-01T00:00:00Z',
        fromDate: '2026-01-01T00:00:00Z',
        toDate: '2026-01-05T00:00:00Z',
      },
    ]);

    const updated = removeBatchFromBed(batch, '2026-01-10T00:00:00Z');

    expect(updated).toBe(batch);
    expect(getActiveBedAssignment(updated, '2026-01-10T00:00:01Z')).toBeNull();
  });
});


describe('batch normalization pipeline', () => {
  it('normalizes legacy shapes and returns migration report', () => {
    const input = [
      {
        batchId: 'legacy-1',
        cropId: 'crop-1',
        variety: { cultivar: 'Black Cherry' },
        start: { at: '2026-01-01T00:00:00Z' },
        status: { state: 'sowing', isActive: true },
        counts: { seedsSown: 12, seedsGerminated: 10, plantsAlive: 8 },
        cuttings: true,
      },
    ];

    const { batches, report } = normalizeBatchesWithReport(input);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      batchId: 'legacy-1',
      variety: 'Black Cherry',
      startedAt: '2026-01-01T00:00:00Z',
      seedCountPlanned: 12,
      seedCountGerminated: 10,
      plantCountAlive: 8,
      stage: 'sowing',
      currentStage: 'sowing',
      propagationType: 'cutting',
      assignments: [],
      photos: [],
    });
    expect(batches[0].stageEvents[0]).toMatchObject({ stage: 'sowing', occurredAt: '2026-01-01T00:00:00Z' });
    expect(report.migrated).toBe(1);
    expect(report.invalidRecords).toEqual([]);
    expect(report.warnings.map((warning) => warning.code)).toContain('legacy_variety_cultivar');
    expect(report.warnings.map((warning) => warning.code)).toContain('legacy_counts_mapped');
    expect(report.warnings.map((warning) => warning.code)).toContain('legacy_propagation_heuristic');
  });

  it('reports invalid records without silently dropping in report', () => {
    const { batches, report } = normalizeBatchesWithReport([
      { batchId: 'bad-1', cropId: 'crop-1', stage: 'sowing', stageEvents: [], assignments: [] },
    ]);

    expect(batches).toEqual([]);
    expect(report.migrated).toBe(0);
    expect(report.invalidRecords).toHaveLength(1);
    expect(report.invalidRecords[0]?.batchId).toBe('bad-1');
    expect(report.invalidRecords[0]?.issues.join(' ')).toContain('stageEvents');
  });

  it('normalizes legacy batches through repository read paths', () => {
    const appState = {
      schemaVersion: 1,
      beds: [],
      crops: [],
      cropPlans: [],
      tasks: [],
      seedInventoryItems: [],
      settings: {
        settingsId: 's',
        locale: 'en',
        timezone: 'Europe/Berlin',
        units: { temperature: 'celsius', yield: 'metric' },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      batches: [
        {
          batchId: 'legacy-read-1',
          cropId: 'crop-1',
          variety: { cultivar: 'Rose' },
          start: { startedAt: '2026-02-01T00:00:00Z' },
          status: { state: 'sowing' },
          bedAssignments: [{ bedId: 'bed-1', assignedAt: '2026-02-01T00:00:00Z' }],
        },
      ],
    };

    const one = getBatchFromAppState(appState, 'legacy-read-1');
    const all = listBatchesFromAppState(appState);

    expect(one?.variety).toBe('Rose');
    expect(one?.assignments).toHaveLength(1);
    expect(all).toHaveLength(1);
    expect(all[0]?.batchId).toBe('legacy-read-1');
  });
});
