import { describe, expect, it } from 'vitest';
import { buildMondayReport } from '../src/report.ts';
import type { Item, Move, StockRequest } from '../src/types.ts';

let n = 0;
const item = (name: string, qty: number, counts: number[], min = 0): Item => ({
  id: String(++n),
  name,
  size: '1.27X50M',
  category: 'Print Media',
  unit: 'Rolls',
  qty,
  min_level: min,
  note: '',
  sort: n,
  active: true,
  created_at: '',
  updated_at: '',
  counts: counts.map((q, i) => ({ date: new Date(Date.UTC(2026, 9, 5 + i * 7)).toISOString().slice(0, 10), qty: q })),
});

const now = new Date('2026-11-02T07:37:00+02:00');

describe('Monday summary', () => {
  it('lists order-now and running-low items with a word count under 250', () => {
    const items = [
      item('GLOSSY', 0, [6, 4, 2, 0]),
      item('MESH', 0, [0, 0, 0, 0]),
      item('MATTE', 3, [9, 7, 5, 3]),
      item('CANVAS', 2, [2, 2, 2, 2], 5),
      item('FROSTY', 60, [62, 61, 61, 60]),
    ];
    const moves: Move[] = [
      { id: 'm1', at: '2026-10-30T10:00:00Z', type: 'out', item_id: '1', item_name: 'GLOSSY 1.27X50M', unit: 'Rolls', delta: -3, metres: null, balance: 0, client: 'MTN', job: 'Billboard', note: '', user_id: null, user_name: 'A', voided: false, voided_by: null, voided_at: null },
    ];
    const requests = [{ status: 'pending' }] as StockRequest[];
    const text = buildMondayReport({ items, moves, requests, now });

    expect(text).toContain('### Order now');
    expect(text).toMatch(/\| GLOSSY 1\.27X50M \| 0 \| 2 \| 12 Rolls \|/);
    expect(text).toContain('At 0 with no recent use: MESH 1.27X50M');
    expect(text).toMatch(/\| MATTE 1\.27X50M \| 3 Rolls \| 1\.5 wk \| 9 \|/);
    expect(text).toContain('Under minimum, no recent use: CANVAS 1.27X50M');
    expect(text).not.toContain('FROSTY');
    expect(text).toContain('Biggest stock outs: GLOSSY 1.27X50M 3 Rolls (MTN)');
    expect(text).toContain('Top clients: MTN (1 job)');
    expect(text).toContain('1 pending request waiting');
    expect(text).toContain('Stock take recorded on 26 Oct 2026');
    expect(text.split(/\s+/).length).toBeLessThan(250);
  });

  it('reminds to log movements and do a stock take', () => {
    const text = buildMondayReport({ items: [item('OLD', 5, [5, 5])], moves: [], requests: [], now });
    expect(text).toContain('No movements logged in the last 7 days');
    expect(text).toContain('No stock take in the last 8 days');
  });
});
