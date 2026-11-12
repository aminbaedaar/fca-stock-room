import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeSqm, type SqmJob } from '../src/sqm.ts';

// Expected results were produced by running the original standalone
// SQM & Wastage Calculator (sqm-wastage.html) on the same jobs.
const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const jobs: SqmJob[] = load('sqm-jobs.json');
const expected: { T: Record<string, number>; errors: number; stock: { key: string; use: number; total: number; waste: number }[] }[] = load('sqm-expected.json');

describe('SQM calculator matches the standalone app', () => {
  jobs.forEach((job, i) => {
    it(`job ${i + 1}`, () => {
      const r = computeSqm(job);
      const e = expected[i];
      expect(r.errors).toBe(e.errors);
      for (const [k, v] of Object.entries(e.T)) expect(r.T[k as keyof typeof r.T], k).toBeCloseTo(v, 9);
      expect(r.stockGroups.map((s) => s.key)).toEqual(e.stock.map((s) => s.key));
      r.stockGroups.forEach((s, n) => {
        expect(s.use).toBeCloseTo(e.stock[n].use, 9);
        expect(s.total).toBeCloseTo(e.stock[n].total, 9);
        expect(s.waste).toBeCloseTo(e.stock[n].waste, 9);
      });
    });
  });

  it('picks the roll width with the least wastage and makes panels for oversize items', () => {
    const r = computeSqm(jobs[0]);
    expect(r.stockGroups[0].W).toBe(250);
    const wall = computeSqm(jobs[3]).locs[0].groups[0];
    expect(wall.panels.a.n).toBe(2);
  });
});

import * as XLSX from 'xlsx';
import { importSheets } from '../src/importer.ts';
import { FCA_SQM_MATERIALS, qtyFor, suggestStockItem, widthsOf } from '../src/sqm.ts';
import type { Item } from '../src/types.ts';

describe('linking calculator materials to stock items', () => {
  const wb = XLSX.read(readFileSync(new URL('../../../data/stock-report-2026-10-26.xlsx', import.meta.url)));
  const items = importSheets(
    wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[name], { header: 1, raw: true, defval: null }) })),
    { alignment: 'aligned' },
  ).items.map((x, n) => ({ ...x, id: String(n), active: true, sort: n, created_at: '', updated_at: '' })) as Item[];
  const match = (name: string, W: number | null) => {
    const it = suggestStockItem(FCA_SQM_MATERIALS.find((m) => m.name === name)!, W, items);
    return it ? `${it.name} ${it.size}` : null;
  };

  it('matches by name and roll width', () => {
    expect(match('Glossy Sticker', 127)).toBe('GLOSSY STICKER 1.27X50M');
    expect(match('Glossy Sticker', 107)).toBe('GLOSSY STICKER 1.07X50M');
    expect(match('One Way Sticker', 152)).toBe('OWV STICKER 1.52X50M');
    expect(match('Backlit Flex Banner', 320)).toBe('BACKLITE BANNER 3.2X36M');
    expect(match('Fabric / Textile', 160)).toBe('TEAR DROP FABRIC 1.6X50M');
    expect(match('Pull-up Material', 95)).toBe('PET MATERIAL PULL UP BANNER 0.95X50M');
  });

  it('matches sheets by thickness', () => {
    expect(match('Foamboard 5 mm', null)).toBe('FOAM BOARD 5MM');
    expect(match('Foamboard 15 mm', null)).toBe('FOAM BOARD 15MM');
    expect(match('Acrylic Sheet 3 mm', null)).toBe('ARCYLIC SHEET CLEAR 3MM');
  });

  it('leaves materials that are not stocked unlinked instead of guessing', () => {
    expect(match('Photo Paper', 127)).toBeNull();
    expect(match('Aluminium Composite (ACP)', null)).toBeNull();
    expect(match('Floor Graphic Vinyl', 137)).toBeNull();
  });

  it('every starting roll width is a width the material is stocked in, where it is stocked', () => {
    for (const m of FCA_SQM_MATERIALS.filter((x) => x.kind === 'roll')) for (const W of widthsOf(m)) suggestStockItem(m, W, items);
  });

  it('converts metres of roll into rolls by the roll length', () => {
    const glossy = items.find((i) => i.name === 'GLOSSY STICKER' && i.size === '1.27X50M')!;
    expect(qtyFor({ mat: FCA_SQM_MATERIALS[0], use: 12.5 }, glossy)).toEqual({ item_id: glossy.id, qty: 0.25, metres: 12.5 });
    const foam = items.find((i) => i.name === 'FOAM BOARD' && i.size === '5MM')!;
    expect(qtyFor({ mat: FCA_SQM_MATERIALS.find((m) => m.kind === 'sheet')!, use: 4 }, foam)).toEqual({ item_id: foam.id, qty: 4, metres: null });
  });
});

it('the starting materials match the database migration', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/0004_sqm.sql', import.meta.url), 'utf8');
  for (const m of FCA_SQM_MATERIALS) expect(sql, m.name).toContain(`('${m.id}',`);
});
