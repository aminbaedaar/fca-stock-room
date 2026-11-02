import type { Category, Count, Unit } from './types.ts';
import { MACHINES, INK_COLOURS } from './ink.ts';
import { parseRollSize } from './units.ts';

// Turns the weekly stock-report sheets (as arrays of cell values, e.g. from
// SheetJS sheet_to_json(ws, { header: 1, raw: true })) into items with history.

export type Alignment =
  /** Dates line up with the columns under them; a count column before the first date is opening stock. */
  | 'aligned'
  /** Each count belongs to the date one column to its right. */
  | 'shiftLeft';

export interface ImportOptions {
  alignment: Alignment;
}

export interface ImportedItem {
  name: string;
  size: string;
  category: Category;
  unit: Unit;
  qty: number;
  min_level: number;
  note: string;
  counts: Count[];
  warnings: string[];
  sheet: string;
  row: number; // 1-based Excel row
}

export interface ImportResult {
  items: ImportedItem[];
  dates: string[];
  warnings: string[];
}

type Cell = string | number | boolean | null | undefined;

const UNIT_WORDS: [RegExp, Unit][] = [
  [/^ROLLS?$/i, 'Rolls'],
  [/^SHEETS?$/i, 'Sheets'],
  [/^(PCS?|PIECES?)$/i, 'Pcs'],
  [/^BOX(ES)?$/i, 'Boxes'],
  [/^BAGS?$/i, 'Bags'],
  [/^(L|LTRS?|LITRES?|LITERS?|LITTERS?)$/i, 'Litres'],
  [/^(M|METRES?|METERS?)$/i, 'Metres'],
];

function unitFromWord(w: string): Unit | null {
  return UNIT_WORDS.find(([re]) => re.test(w))?.[1] ?? null;
}

/** Parse a cell such as 240, "240 rolls", "5ROLLS", "6 BOXES+9PCS", "205.5 sheets". */
export function parseQtyCell(v: Cell): { qty: number; unit: Unit | null; extra: string } | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? { qty: v, unit: null, extra: '' } : null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)\s*([A-Za-z]*)\s*(\+.*)?$/.exec(s);
  if (!m) return null;
  return { qty: Number(m[1]), unit: m[2] ? unitFromWord(m[2]) : null, extra: (m[3] ?? '').replace(/\s+/g, ' ').trim() };
}

/** "30.07.026", "21.09.2026", "2026-09-21" or an Excel serial number → YYYY-MM-DD */
export function parseDateCell(v: Cell): string | null {
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s);
  if (m) {
    const d = +m[1], mo = +m[2];
    // "26" and "026" both mean 2026.
    const y = m[3].length <= 3 ? 2000 + (+m[3] % 100) : +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? s : null;
}

const clean = (v: Cell) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const isHeaderWord = (s: string) => /^(DESCRIPTION|COLOU?RS|SIZE|PCS|IN LITT?ERS?)$/i.test(s);

function machineCanon(text: string): string | null {
  const m = MACHINES.find((x) => x.match.test(text));
  if (!m) return null;
  return { 'SK-1': 'SK-1', 'SK-7': 'SK-7', R8: 'UV FLATBED R8', S6: 'UV ROLL TO ROLL S6', WIT: 'WIT COLOR' }[m.id];
}

function categoryFromSection(text: string, current: Category): Category {
  const t = text.toUpperCase();
  if (/FLEXI|BANNER/.test(t)) return 'Flexi Banner';
  if (/STAND|FRAME/.test(t)) return 'Stands & Frames';
  if (/INK|SOLVENT/.test(t)) return 'Ink & Solvent';
  if (/MEDIA|STICKER|MATERIAL/.test(t)) return current;
  return current;
}

export function importSheets(sheets: { name: string; rows: Cell[][] }[], opts: ImportOptions): ImportResult {
  const items: ImportedItem[] = [];
  const allDates = new Set<string>();
  const warnings: string[] = [];

  for (const sheet of sheets) {
    const isInk = /INK/i.test(sheet.name);
    let category: Category = isInk ? 'Ink & Solvent' : 'Print Media';
    let dateCols = new Map<number, string>(); // column index → date
    let sizeCol = -1;
    let nameCol = -1; // unknown until a DESCRIPTION / COLORS header row
    let machine: string | null = null;

    sheet.rows.forEach((row, r) => {
      row = row ?? [];
      // A row with 3+ dates is a date header.
      const found = new Map<number, string>();
      row.forEach((c, i) => {
        const d = parseDateCell(c);
        if (d) found.set(i, d);
      });
      if (found.size >= 3) {
        dateCols = found;
        found.forEach((d) => allDates.add(d));
      }

      const texts = row.map(clean);
      // Header row: tells us where the name and size columns are.
      const descIdx = texts.findIndex((t) => /^(DESCRIPTION|COLOU?RS)$/i.test(t));
      if (descIdx >= 0) {
        nameCol = descIdx;
        sizeCol = texts.findIndex((t) => /^SIZE$/i.test(t));
        if (found.size < 3) return;
      }
      if (found.size >= 3) return;

      // Before any header row, the first text cell is the label (e.g. "WIT COLOR INK").
      const labelCol = nameCol >= 0 ? nameCol : texts.findIndex((t) => t && parseQtyCell(t) == null);
      const label = labelCol >= 0 ? texts[labelCol] : '';
      if (!label || isHeaderWord(label)) return;

      // Values: every numeric-looking cell after the name/size columns.
      const firstVal = Math.max(labelCol, sizeCol) + 1;
      const values: { col: number; v: NonNullable<ReturnType<typeof parseQtyCell>> }[] = [];
      for (let c = firstVal; c < row.length; c++) {
        const v = parseQtyCell(row[c]);
        if (v) values.push({ col: c, v });
      }

      if (!values.length) {
        // A section title such as "FLEXI BANNER MATERIAL" or "SK-7 INK".
        category = categoryFromSection(label, category);
        if (isInk) machine = machineCanon(label) ?? machine;
        return;
      }

      // Name and size
      let name = label.toUpperCase();
      let size = sizeCol >= 0 ? clean(row[sizeCol]).toUpperCase() : '';
      if (isInk) {
        const own = machineCanon(name);
        const m = own ?? machine;
        const colour = INK_COLOURS.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(name));
        if (m && colour && (own == null || name.replace(/SK-?\s?\d|INK|\s/gi, '').toLowerCase() === colour)) {
          name = `${m} INK`;
          size = colour.toUpperCase();
        } else if (!own && m) {
          name = `${m} ${name}`;
        }
      }

      // Unit: the most common unit word in the row.
      const tally = new Map<Unit, number>();
      for (const { v } of values) if (v.unit) tally.set(v.unit, (tally.get(v.unit) ?? 0) + 1);
      let unit = (isInk ? 'Litres' : 'Pcs') as Unit;
      let best = 0;
      tally.forEach((n, u) => {
        if (n > best) [unit, best] = [u, n];
      });
      // No unit written (e.g. always 0): a size like 3.2X50M means rolls.
      if (!best && parseRollSize(size)) unit = 'Rolls';

      const dateKeys = [...dateCols.keys()].sort((a, b) => a - b);
      const firstDateCol = dateKeys[0] ?? Infinity;
      const lastDateCol = dateKeys[dateKeys.length - 1] ?? -Infinity;
      const itemWarnings: string[] = [];
      const counts: Count[] = [];
      let newer: number | null = null;
      let opening: number | null = null;
      const extras = new Set<string>();

      for (const { col, v } of values) {
        if (v.unit && v.unit !== unit && (v.unit === 'Boxes' || unit === 'Boxes')) {
          itemWarnings.push(`Skipped "${clean(row[col])}" (different unit)`);
          continue;
        }
        if (v.extra) extras.add(v.extra);
        const dateCol = opts.alignment === 'shiftLeft' ? col + 1 : col;
        const date = dateCols.get(dateCol);
        if (date) counts.push({ date, qty: v.qty });
        else if (dateCol > lastDateCol) newer = v.qty;
        else if (dateCol < firstDateCol) opening = v.qty;
      }

      counts.sort((a, b) => (a.date < b.date ? -1 : 1));
      const last = counts[counts.length - 1];
      const qty = newer ?? last?.qty ?? opening ?? 0;
      if (newer != null) itemWarnings.push(`Current stock ${newer} taken from the column after the last date`);
      if (extras.size) itemWarnings.push(`Loose pieces noted: ${[...extras].join(', ')}`);

      items.push({
        name,
        size,
        category,
        unit,
        qty,
        min_level: 0,
        note: extras.size ? `Excel also listed ${[...extras].pop()}` : '',
        counts,
        warnings: itemWarnings,
        sheet: sheet.name.trim(),
        row: r + 1,
      });
    });
  }

  if (!items.length) warnings.push('No items found. Check that the sheet has a DESCRIPTION header row and date columns.');
  return { items, dates: [...allDates].sort(), warnings };
}

/**
 * Simple list format: a header row with Name, Size, Category, Unit, Qty, Min.
 * Used for the generic "map columns" path of the import screen.
 */
export interface ColumnMap {
  name: number;
  size?: number;
  category?: number;
  unit?: number;
  qty: number;
  min?: number;
  note?: number;
}

export function importList(rows: Cell[][], map: ColumnMap, headerRow: number, sheet = 'Sheet1'): ImportResult {
  const items: ImportedItem[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const name = clean(row[map.name]);
    if (!name) continue;
    const q = parseQtyCell(row[map.qty]);
    const unitText = map.unit != null ? clean(row[map.unit]) : '';
    const unit = (unitFromWord(unitText) ?? q?.unit ?? 'Pcs') as Unit;
    const catText = map.category != null ? clean(row[map.category]) : '';
    const category = categoryFromSection(catText, 'Print Media');
    items.push({
      name: name.toUpperCase(),
      size: map.size != null ? clean(row[map.size]).toUpperCase() : '',
      category,
      unit,
      qty: q?.qty ?? 0,
      min_level: map.min != null ? parseQtyCell(row[map.min])?.qty ?? 0 : 0,
      note: map.note != null ? clean(row[map.note]) : '',
      counts: [],
      warnings: q ? [] : ['No quantity, set to 0'],
      sheet,
      row: r + 1,
    });
  }
  return { items, dates: [], warnings: [] };
}
