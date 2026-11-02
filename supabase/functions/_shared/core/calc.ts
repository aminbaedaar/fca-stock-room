import type { Count, Item } from './types.ts';
import { daysBetween } from './dates.ts';

// One place for every stock number shown in the app, the reports and the AI
// assistant. See README "Calculations" for the rules in plain words.

export const HISTORY_POINTS = 9;
export const LOW_COVER_WEEKS = 3;
export const ORDER_WEEKS = 6;

export type Status = 'out' | 'low' | 'ok';

export interface ItemStats {
  weeklyUse: number; // units per week, 0 when no recent use
  cover: number; // weeks; Infinity when no use
  suggestedOrder: number; // whole units, 0 = no order needed
  status: Status;
  corrections: number; // decreases ignored as count corrections
  points: Count[]; // the history points used, oldest first
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The last N count points sorted by date (one per date, the latest wins). */
export function recentPoints(counts: Count[], n = HISTORY_POINTS): Count[] {
  const byDate = new Map<string, number>();
  for (const c of counts) byDate.set(c.date, c.qty);
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, qty]) => ({ date, qty }))
    .slice(-n);
}

/**
 * Average use per week from count history.
 * A decrease counts as a correction (not real use) when it is more than half
 * of the previous count AND at least 4x the median of the item's other decreases.
 */
export function weeklyUse(counts: Count[]): { use: number; corrections: number; points: Count[] } {
  const points = recentPoints(counts);
  if (points.length < 2) return { use: 0, corrections: 0, points };

  const drops: { amount: number; prev: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = points[i - 1].qty - points[i].qty;
    if (d > 0) drops.push({ amount: d, prev: points[i - 1].qty });
  }

  let used = 0;
  let corrections = 0;
  drops.forEach((drop, i) => {
    const others = drops.filter((_, j) => j !== i).map((x) => x.amount);
    const med = median(others);
    const isCorrection = drop.amount > drop.prev / 2 && others.length > 0 && drop.amount >= 4 * med;
    if (isCorrection) corrections++;
    else used += drop.amount;
  });

  const weeks = daysBetween(points[0].date, points[points.length - 1].date) / 7;
  const use = weeks > 0 ? used / weeks : 0;
  return { use, corrections, points };
}

export function weeksOfCover(qty: number, use: number): number {
  if (use <= 0) return Infinity;
  return qty / use;
}

export function suggestedOrder(qty: number, minLevel: number, use: number): number {
  const need = Math.max(minLevel, ORDER_WEEKS * use) - qty;
  // Small epsilon so 2.0000001 does not round up to 3.
  const n = Math.ceil(need - 1e-9);
  return n > 0 ? n : 0;
}

export function stockStatus(qty: number, minLevel: number, cover: number): Status {
  if (qty <= 0) return 'out';
  if (qty <= minLevel || cover < LOW_COVER_WEEKS) return 'low';
  return 'ok';
}

export function itemStats(item: Pick<Item, 'qty' | 'min_level' | 'counts'>): ItemStats {
  const { use, corrections, points } = weeklyUse(item.counts ?? []);
  const cover = weeksOfCover(item.qty, use);
  return {
    weeklyUse: use,
    cover,
    suggestedOrder: suggestedOrder(item.qty, item.min_level, use),
    status: stockStatus(item.qty, item.min_level, cover),
    corrections,
    points,
  };
}

/** Items that need attention: out, at/under minimum, or under 3 weeks of cover. */
export function needsAttention<T extends Item>(items: T[]): { item: T; stats: ItemStats }[] {
  return items
    .filter((i) => i.active)
    .map((item) => ({ item, stats: itemStats(item) }))
    .filter((x) => x.stats.status !== 'ok')
    .sort((a, b) => rank(a.stats) - rank(b.stats) || a.stats.cover - b.stats.cover);
}

function rank(s: ItemStats): number {
  // Out with recent use first, then low, then out with no use.
  if (s.status === 'out') return s.weeklyUse > 0 ? 0 : 2;
  return 1;
}

export function fmtCover(cover: number): string {
  if (!isFinite(cover)) return '–';
  if (cover >= 52) return '52+ wk';
  return `${cover < 10 ? cover.toFixed(1) : Math.round(cover)} wk`;
}
