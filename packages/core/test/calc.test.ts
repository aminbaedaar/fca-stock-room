import { describe, expect, it } from 'vitest';
import { itemStats, recentPoints, stockStatus, suggestedOrder, weeklyUse, weeksOfCover } from '../src/calc.ts';
import type { Count } from '../src/types.ts';

const weekly = (start: string, qtys: number[]): Count[] =>
  qtys.map((qty, i) => ({ date: new Date(Date.parse(start) + i * 7 * 86_400_000).toISOString().slice(0, 10), qty }));

describe('weeklyUse', () => {
  it('averages decreases over the weeks covered', () => {
    // 10 → 8 → 6 → 4 over 3 weeks = 2/week
    expect(weeklyUse(weekly('2026-09-07', [10, 8, 6, 4])).use).toBeCloseTo(2);
  });

  it('ignores increases (restocks)', () => {
    // drops 2 + 2 = 4 over 3 weeks
    expect(weeklyUse(weekly('2026-09-07', [10, 8, 20, 18])).use).toBeCloseTo(4 / 3);
  });

  it('uses only the last 9 points', () => {
    const c = weekly('2026-01-05', [100, 50, 40, 40, 40, 40, 40, 40, 40, 40, 40]);
    expect(recentPoints(c)).toHaveLength(9);
    // The last 9 points are all 40: no use.
    expect(weeklyUse(c).use).toBe(0);
  });

  it('ignores a count correction: >half of previous and ≥4× median of other drops', () => {
    // drops: 1, 1, 24 → 24 > 25/2 and 24 ≥ 4×1 → correction
    const r = weeklyUse(weekly('2026-09-07', [27, 26, 25, 1]));
    expect(r.corrections).toBe(1);
    expect(r.use).toBeCloseTo(2 / 3);
  });

  it('keeps a big drop that is not more than half of the previous count', () => {
    // drops: 1, 1, 10 from 100 → not more than half → real use
    const r = weeklyUse(weekly('2026-09-07', [102, 101, 100, 90]));
    expect(r.corrections).toBe(0);
    expect(r.use).toBeCloseTo(12 / 3);
  });

  it('keeps a drop of more than half when it is under 4× the median', () => {
    // drops: 3, 3, 4 (4 > 6/2 but 4 < 12)
    const r = weeklyUse(weekly('2026-09-07', [13, 10, 7, 3]));
    expect(r.corrections).toBe(0);
    expect(r.use).toBeCloseTo(10 / 3);
  });

  it('keeps a single drop when there are no other drops to compare', () => {
    expect(weeklyUse(weekly('2026-09-07', [10, 10, 2])).corrections).toBe(0);
  });

  it('returns 0 with fewer than two points', () => {
    expect(weeklyUse([{ date: '2026-10-26', qty: 5 }]).use).toBe(0);
    expect(weeklyUse([]).use).toBe(0);
  });

  it('sorts points by date and keeps the last value per date', () => {
    const c: Count[] = [
      { date: '2026-10-19', qty: 6 },
      { date: '2026-10-05', qty: 10 },
      { date: '2026-10-12', qty: 9 },
      { date: '2026-10-12', qty: 8 },
    ];
    expect(recentPoints(c).map((p) => p.qty)).toEqual([10, 8, 6]);
    expect(weeklyUse(c).use).toBeCloseTo(2);
  });
});

describe('cover, order and status', () => {
  it('weeks of cover = qty ÷ weekly use', () => {
    expect(weeksOfCover(10, 2)).toBe(5);
    expect(weeksOfCover(10, 0)).toBe(Infinity);
  });

  it('suggested order = ceil(max(min, 6 × use) − qty)', () => {
    expect(suggestedOrder(4, 0, 2)).toBe(8); // 12 − 4
    expect(suggestedOrder(4, 20, 2)).toBe(16); // min is higher
    expect(suggestedOrder(4, 0, 0.5)).toBe(0); // 3 − 4 ≤ 0
    expect(suggestedOrder(0, 0, 1.1)).toBe(7); // ceil(6.6)
    expect(suggestedOrder(1, 0, 0.5)).toBe(2); // exactly 2, not 3
  });

  it('status: out, low (min or cover), ok', () => {
    expect(stockStatus(0, 5, Infinity)).toBe('out');
    expect(stockStatus(5, 5, Infinity)).toBe('low');
    expect(stockStatus(10, 0, 2.9)).toBe('low');
    expect(stockStatus(10, 0, 3)).toBe('ok');
    expect(stockStatus(10, 0, Infinity)).toBe('ok');
  });

  it('itemStats ties it together', () => {
    const s = itemStats({ qty: 4, min_level: 0, counts: weekly('2026-09-07', [10, 8, 6, 4]) });
    expect(s.weeklyUse).toBeCloseTo(2);
    expect(s.cover).toBeCloseTo(2);
    expect(s.status).toBe('low');
    expect(s.suggestedOrder).toBe(8);
  });
});
