import { describe, expect, it } from 'vitest';
import { expandTaskRuleWindowsToLocalDates } from './index';

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
