import { describe, expect, it } from 'vitest';
import { buildTicks } from './Timeline';

describe('buildTicks', () => {
  it('spaces ticks evenly across the run', () => {
    expect(buildTicks(1000)).toEqual([0, 200, 400, 600, 800, 1000]);
  });

  it('never repeats a tick on a run lasting a few milliseconds', () => {
    // Ticks double as React keys; a repeat drops or duplicates a gridline.
    for (const total of [1, 2, 3, 7]) {
      const ticks = buildTicks(total);
      expect(new Set(ticks).size).toBe(ticks.length);
    }
    expect(buildTicks(2)).toEqual([0, 1, 2]);
  });
});
