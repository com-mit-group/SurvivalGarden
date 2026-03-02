import { describe, expect, it } from 'vitest';
import type { Batch } from '../../contracts';
import { assignBatchToBed, getActiveBedAssignment } from './batchRepository';

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
