import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { importSheets, parseDateCell, parseQtyCell } from '../src/importer.ts';
import { inkByMachine, machineOf } from '../src/ink.ts';
import type { Item } from '../src/types.ts';

function loadWorkbook() {
  const buf = readFileSync(new URL('../../../data/stock-report-2026-10-26.xlsx', import.meta.url));
  const wb = XLSX.read(buf);
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[name], { header: 1, raw: true, defval: null }),
  }));
}

describe('cell parsing', () => {
  it('reads quantities with unit words', () => {
    expect(parseQtyCell('240 rolls')).toEqual({ qty: 240, unit: 'Rolls', extra: '' });
    expect(parseQtyCell('5ROLLS')).toMatchObject({ qty: 5, unit: 'Rolls' });
    expect(parseQtyCell('205.5 sheets')).toMatchObject({ qty: 205.5, unit: 'Sheets' });
    expect(parseQtyCell('6 BOXES+9PCS')).toEqual({ qty: 6, unit: 'Boxes', extra: '+9PCS' });
    expect(parseQtyCell(0)).toMatchObject({ qty: 0 });
    expect(parseQtyCell('')).toBeNull();
    expect(parseQtyCell(' ')).toBeNull();
  });

  it('reads dd.mm.yyy dates', () => {
    expect(parseDateCell('30.07.026')).toBe('2026-07-30');
    expect(parseDateCell('21.09.2026')).toBe('2026-09-21');
    expect(parseDateCell('GLOSSY')).toBeNull();
  });
});

describe('importing the October 2026 stock report', () => {
  const sheets = loadWorkbook();
  const { items } = importSheets(sheets, { alignment: 'aligned' });
  const find = (name: string, size: string) => items.find((i) => i.name.startsWith(name) && i.size === size)!;

  it('finds all 76 items', () => {
    expect(items).toHaveLength(76);
    expect(items.filter((i) => i.category === 'Print Media')).toHaveLength(31);
    expect(items.filter((i) => i.category === 'Flexi Banner')).toHaveLength(8);
    expect(items.filter((i) => i.category === 'Stands & Frames')).toHaveLength(16);
    expect(items.filter((i) => i.category === 'Ink & Solvent')).toHaveLength(21);
  });

  it('lines counts up with dates (first column is opening stock)', () => {
    const g = find('GLOSSY STICKER', '1.27X50M');
    expect(g.unit).toBe('Rolls');
    expect(g.counts[0]).toEqual({ date: '2026-07-30', qty: 240 });
    expect(g.counts.at(-1)).toEqual({ date: '2026-10-26', qty: 195 });
    expect(g.qty).toBe(194); // newer count after the last date
  });

  it('names ink by machine and colour', () => {
    const cyan = find('SK-7 INK', 'CYAN');
    expect(cyan.unit).toBe('Litres');
    expect(cyan.counts.at(-1)).toEqual({ date: '2026-10-26', qty: 0 });
    expect(find('UV ROLL TO ROLL S6 INK', 'WHITE').qty).toBe(45);
    expect(find('SK-1 INK', 'BLACK').qty).toBe(2);
    expect(items.find((i) => i.name === 'UV ROLL TO ROLL S6 UV FLUSH')?.qty).toBe(14);
    for (const i of items.filter((x) => x.category === 'Ink & Solvent')) expect(machineOf(i.name), i.name).not.toBeNull();
  });

  it('groups ink into the five machines', () => {
    const asItems = items.map((x, n) => ({ ...x, id: String(n), active: true, sort: n, created_at: '', updated_at: '' })) as Item[];
    expect(inkByMachine(asItems).map((g) => g.machine.id).sort()).toEqual(['R8', 'S6', 'SK-1', 'SK-7', 'WIT']);
  });

  it('skips counts in a different unit and keeps loose pieces as a note', () => {
    const pop = items.find((i) => i.name === 'GROUND POP-UP METAL STAND')!;
    expect(pop.unit).toBe('Pcs');
    expect(pop.qty).toBe(135);
    const frame = find('A2 FRAME', 'A2');
    expect(frame.unit).toBe('Boxes');
    expect(frame.note).toContain('+6PCS');
  });

  it('shift-left alignment moves counts one date earlier', () => {
    const shifted = importSheets(sheets, { alignment: 'shiftLeft' }).items;
    const g = shifted.find((i) => i.name === 'GLOSSY STICKER' && i.size === '1.27X50M')!;
    expect(g.counts[0]).toEqual({ date: '2026-07-30', qty: 272 });
  });
});
