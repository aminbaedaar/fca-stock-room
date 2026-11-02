import { fmtDateTime, itemLabel, itemStats, round, type Item, type Move } from '@fca/core';
import { exportRows } from './excel';
import type { Snapshot } from '../data/types';

const cover = (c: number) => (isFinite(c) ? round(c, 1) : '');

export function stockRows(items: Item[]) {
  return items.map((i) => {
    const s = itemStats(i);
    return {
      Category: i.category,
      Item: i.name,
      Size: i.size,
      Unit: i.unit,
      'In stock': i.qty,
      Minimum: i.min_level,
      Status: s.status.toUpperCase(),
      'Use / week': round(s.weeklyUse, 2),
      'Weeks of cover': cover(s.cover),
      'Suggested order': s.suggestedOrder || '',
      Note: i.note,
    };
  });
}

export function moveRows(moves: Move[]) {
  return moves.map((m) => ({
    When: fmtDateTime(m.at),
    Item: m.item_name,
    Type: m.type,
    Change: m.delta,
    Unit: m.unit,
    Metres: m.metres ?? '',
    Balance: m.balance ?? '',
    Client: m.client,
    Job: m.job,
    Note: m.note,
    By: m.user_name,
    Reversed: m.voided ? 'YES' : '',
  }));
}

export function exportStock(items: Item[]) {
  return exportRows('FCA stock list', [{ name: 'Stock', rows: stockRows(items.filter((i) => i.active)) }]);
}

export function exportMoves(moves: Move[]) {
  return exportRows('FCA movements', [{ name: 'Movements', rows: moveRows(moves) }]);
}

/** Admin "Download full backup": every table in one workbook. */
export function exportBackup(s: Snapshot) {
  const counts = s.items.flatMap((i) => i.counts.map((c) => ({ Item: itemLabel(i), item_id: i.id, Date: c.date, Qty: c.qty })));
  return exportRows('FCA full backup', [
    { name: 'Items', rows: s.items.map(({ counts: _c, ...rest }) => rest) },
    { name: 'Counts', rows: counts },
    { name: 'Movements', rows: s.moves.map((m) => ({ ...m })) },
    { name: 'Requests', rows: s.requests.map((r) => ({ ...r })) },
    { name: 'Reports', rows: s.reports.map((r) => ({ ...r })) },
    { name: 'Members', rows: s.members.map((m) => ({ ...m })) },
  ]);
}
