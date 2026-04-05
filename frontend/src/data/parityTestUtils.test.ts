import { describe, expect, it } from 'vitest';

import { summarizeParityDiffs } from './parityTestUtils';

describe('summarizeParityDiffs', () => {
  it('reports deterministic path-level expected/actual diffs with normalized object key ordering', () => {
    const expectedTs = {
      profile: {
        beta: 2,
        alpha: 1,
      },
    };
    const actualBackend = {
      profile: {
        alpha: 1,
        beta: 9,
      },
    };

    expect(summarizeParityDiffs(expectedTs, actualBackend)).toStrictEqual([
      '$.profile.beta: expected 2, actual 9',
    ]);
  });

  it('limits output to the first 20 diffs and appends a truncation notice', () => {
    const expectedTs = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index}`, index]));
    const actualBackend = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index}`, index + 1]));

    const diffs = summarizeParityDiffs(expectedTs, actualBackend);

    expect(diffs).toHaveLength(21);
    expect(diffs[0]).toBe('$.k0: expected 0, actual 1');
    expect(diffs[19]).toBe('$.k4: expected 4, actual 5');
    expect(diffs[20]).toBe('...truncated after first 20 diffs');
  });
});
