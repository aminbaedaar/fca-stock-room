// SQM & wastage calculation, carried over from the standalone SQM & Wastage
// Calculator (sqm-wastage.html) so both give the same numbers.
//
// Items of one material in one location are laid out together on the roll (or
// sheets), mixing sizes and turning pieces to fill gaps. Every roll width the
// material comes in is tried; the one with the least wastage wins. The old
// one-item-at-a-time layout is always tried too, so a result is never worse.
// All sizes are in centimetres; areas in m².

import type { Item } from './types.ts';
import { parseRollSize } from './units.ts';

export type BleedMode = 'no' | 'yes' | 'custom';

export interface SqmMaterial {
  id: string;
  name: string;
  kind: 'roll' | 'sheet';
  /** Roll widths in cm, e.g. "320, 250"; falls back to `width`. */
  widths?: string;
  /** Roll width (old single-width form) or sheet width, cm. */
  width: number;
  /** Sheet length, cm (0 for rolls). */
  length: number;
  bleed: number;
  overlap?: number;
  /** Stock items this material is taken from: roll width in cm ("127") or "sheet" → item id. */
  links?: Record<string, string>;
}

export interface SqmItem {
  id: string;
  name: string;
  mat: string;
  w: number | string;
  h: number | string;
  qty: number | string;
}

export interface SqmLocation {
  id: string;
  name: string;
  items: SqmItem[];
}

export interface SqmJob {
  job: string;
  client: string;
  by: string;
  date: string;
  bleedMode: BleedMode;
  bleedCm?: number | string;
  materials: SqmMaterial[];
  locations: SqmLocation[];
}

export type SqmRowBase = { error: string } | { empty: true } | { w: number; h: number; q: number; real: number };
export type SqmRow = { it: SqmItem; mat: SqmMaterial | undefined; r: SqmRowBase };
type OkRow = { it: SqmItem; mat: SqmMaterial; r: { w: number; h: number; q: number; real: number } };
type Piece = { w: number; h: number; id: string; o?: number[][] };
type Rect = { x: number; y: number; w: number; h: number };
type Panel = { n: number; pw: number; along: number };

export interface SqmGroup {
  mat: SqmMaterial;
  rows: OkRow[];
  real: number;
  pcs: number;
  error?: string;
  W?: number;
  len?: number;
  sheets?: number;
  use: number;
  run: number;
  total: number;
  waste: number;
  panels: Record<string, Panel>;
  /** Roll widths tried for this group, with the total SQM each would use. */
  tried?: { W: number; len: number; total: number }[];
  sizeTxt: string;
  useTxt: string;
}

export interface SqmStockGroup {
  /** "materialId|width" or "materialId|sheet" */
  key: string;
  mat: SqmMaterial;
  W: number | null;
  sizeTxt: string;
  entries: { loc: string; g: SqmGroup }[];
  /** metres of roll, or number of sheets */
  use: number;
  real: number;
  waste: number;
  total: number;
  pcs: number;
  useTxt: string;
}

export interface SqmResult {
  locs: {
    L: SqmLocation;
    rows: SqmRow[];
    groups: SqmGroup[];
    items: number;
    pcs: number;
    run: number;
    real: number;
    waste: number;
    total: number;
  }[];
  T: { items: number; pcs: number; run: number; real: number; waste: number; total: number };
  stockGroups: SqmStockGroup[];
  errors: number;
}

const EPS = 1e-6;
const MAX_PIECES = 500;

export const mTrim = (cm: number) => String(+(cm / 100).toFixed(3));
export const widthsOf = (m: SqmMaterial) =>
  [...new Set(String(m.widths ?? m.width ?? '').split(/[,;/\s]+/).map(Number).filter((n) => n > 0))].sort((a, b) => b - a);
export const matSize = (m: SqmMaterial) =>
  m.kind === 'roll'
    ? `${widthsOf(m).map(mTrim).join(' / ') || '?'} m roll`
    : `${(m.width / 100).toFixed(2)}×${(m.length / 100).toFixed(2)} m sheet`;
const rollTxt = (W: number) => `${mTrim(W)} m roll`;
const sheetsTxt = (n: number) => (n === 1 ? '1 sheet' : `${n} sheets`);
const useShort = (mat: SqmMaterial, use: number) => (mat.kind === 'roll' ? `${use.toFixed(2)} m` : sheetsTxt(use));

function itemBase(it: SqmItem, mat: SqmMaterial | undefined): SqmRowBase {
  const w = +it.w,
    h = +it.h,
    q = Math.floor(+it.qty);
  if (!mat) return { error: 'Pick a material' };
  if (!(w > 0 && h > 0 && q > 0)) return { empty: true };
  return { w, h, q, real: (w * h * q) / 1e4 };
}

// Free-rectangle packing: each piece goes where its top edge ends lowest, turned if that is lower.
const contains = (b: Rect, a: Rect) => a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS;
function placeIn(free: Rect[], p: Piece) {
  let best: (Rect & { top: number }) | null = null;
  for (const f of free)
    for (const [pw, ph] of p.o || (p.w === p.h ? [[p.w, p.h]] : [[p.w, p.h], [p.h, p.w]])) {
      if (pw > f.w + EPS || ph > f.h + EPS) continue;
      const top = f.y + ph;
      if (!best || top < best.top - EPS || (top < best.top + EPS && f.x < best.x - EPS)) best = { x: f.x, y: f.y, w: pw, h: ph, top };
    }
  return best;
}
function splitFree(free: Rect[], r: Rect) {
  const out: Rect[] = [];
  for (const f of free) {
    if (r.x >= f.x + f.w - EPS || r.x + r.w <= f.x + EPS || r.y >= f.y + f.h - EPS || r.y + r.h <= f.y + EPS) {
      out.push(f);
      continue;
    }
    if (r.x > f.x + EPS) out.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
    if (r.x + r.w < f.x + f.w - EPS) out.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
    if (r.y > f.y + EPS) out.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
    if (r.y + r.h < f.y + f.h - EPS) out.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
  }
  return out.filter((a, i) => !out.some((b, j) => j !== i && contains(b, a) && (!contains(a, b) || j < i)));
}
const ORDERS = [
  (a: Piece, b: Piece) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
  (a: Piece, b: Piece) => b.w * b.h - a.w * a.h || Math.max(b.w, b.h) - Math.max(a.w, a.h),
];
// Layouts are also tried with pieces kept as entered, all turned, and each item in its own best direction.
const MODES = ['free', 'asis', 'turned', 'best'] as const;
function withMode(pieces: Piece[], mode: (typeof MODES)[number], maxW: number, maxH: number, pref: Record<string, number[]>): Piece[] {
  if (mode === 'free') return pieces;
  return pieces.map((p) => {
    let o = mode === 'asis' ? [p.w, p.h] : mode === 'turned' ? [p.h, p.w] : pref[p.id] || [p.w, p.h];
    if (o[0] > maxW + EPS || o[1] > maxH + EPS) o = [o[1], o[0]];
    return { ...p, o: [o] };
  });
}
function packStrip(W: number, pieces: Piece[], order: (a: Piece, b: Piece) => number) {
  let free: Rect[] = [{ x: 0, y: 0, w: W, h: 1e9 }],
    len = 0;
  for (const p of pieces.slice().sort(order)) {
    const r = placeIn(free, p);
    if (!r) return Infinity;
    len = Math.max(len, r.top);
    free = splitFree(free, r);
  }
  return len;
}
function packSheets(SW: number, SH: number, pieces: Piece[], order: (a: Piece, b: Piece) => number) {
  const bins: Rect[][] = [];
  for (const p of pieces.slice().sort(order)) {
    let done = false;
    for (const bin of bins) {
      const r = placeIn(bin, p);
      if (r) {
        bin.splice(0, bin.length, ...splitFree(bin, r));
        done = true;
        break;
      }
    }
    if (!done) {
      const bin = [{ x: 0, y: 0, w: SW, h: SH }],
        r = placeIn(bin, p);
      if (!r) return Infinity;
      bin.splice(0, 1, ...splitFree(bin, r));
      bins.push(bin);
    }
  }
  return bins.length;
}

/** Works out one job. `bleedOf` follows the job's bleed setting. */
export function computeSqm(job: SqmJob): SqmResult {
  const bleedMode = job.bleedMode || 'no';
  const bleedOf = (mat: SqmMaterial) => (bleedMode === 'custom' ? Math.max(0, +(job.bleedCm ?? 0) || 0) : bleedMode === 'yes' ? +mat.bleed || 0 : 0);

  // Each item's best direction on its own: the one that needs the shorter run.
  function prefRoll(W: number, rows: OkRow[], mat: SqmMaterial, panels: Record<string, Panel>) {
    const b = bleedOf(mat),
      pref: Record<string, number[]> = {};
    for (const x of rows) {
      const P = panels[x.it.id],
        a = P ? P.pw + 2 * b : x.r.w + 2 * b,
        c = P ? P.along + 2 * b : x.r.h + 2 * b,
        n = P ? x.r.q * P.n : x.r.q;
      const run = (pw: number, ph: number) => (pw > W + EPS ? Infinity : Math.ceil(n / Math.floor((W + EPS) / pw)) * ph);
      pref[x.it.id] = run(a, c) <= run(c, a) ? [a, c] : [c, a];
    }
    return pref;
  }
  // Pieces for one roll width; items wider than the roll both ways become equal overlapping panels.
  function rollPieces(rows: OkRow[], mat: SqmMaterial, W: number) {
    const b = bleedOf(mat),
      ov = +(mat.overlap ?? 2) || 0,
      pieces: Piece[] = [],
      panels: Record<string, Panel> = {};
    for (const x of rows) {
      const { w, h, q } = x.r;
      if (Math.min(w, h) + 2 * b <= W + EPS) {
        for (let i = 0; i < q; i++) pieces.push({ w: w + 2 * b, h: h + 2 * b, id: x.it.id });
        continue;
      }
      const usable = W - 2 * b;
      if (usable <= ov) return null;
      let best: Panel | null = null;
      for (const [across, along] of [
        [w, h],
        [h, w],
      ]) {
        const n = Math.ceil((across - ov) / (usable - ov) - EPS),
          pw = (across + (n - 1) * ov) / n;
        if (!best || n * along < best.n * best.along) best = { n, pw, along };
      }
      panels[x.it.id] = best!;
      for (let i = 0; i < q * best!.n; i++) pieces.push({ w: best!.pw + 2 * b, h: best!.along + 2 * b, id: x.it.id });
    }
    return { pieces, panels };
  }
  // The old method: each item in its own block of rows. Used as a floor and for very large jobs.
  function gridStrip(W: number, rows: OkRow[], mat: SqmMaterial, panels: Record<string, Panel>) {
    const b = bleedOf(mat);
    let len = 0;
    for (const x of rows) {
      const P = panels[x.it.id],
        a = P ? P.pw + 2 * b : x.r.w + 2 * b,
        c = P ? P.along + 2 * b : x.r.h + 2 * b,
        n = P ? x.r.q * P.n : x.r.q;
      let best = Infinity;
      for (const [pw, ph] of [
        [a, c],
        [c, a],
      ]) {
        if (pw > W + EPS) continue;
        best = Math.min(best, Math.ceil(n / Math.floor((W + EPS) / pw)) * ph);
      }
      len += best;
    }
    return len;
  }
  function rollGroup(mat: SqmMaterial, rows: OkRow[]) {
    let best: { W: number; len: number; total: number; panels: Record<string, Panel> } | null = null;
    const tried: { W: number; len: number; total: number }[] = [];
    for (const W of widthsOf(mat)) {
      const pp = rollPieces(rows, mat, W);
      if (!pp) continue;
      let len = gridStrip(W, rows, mat, pp.panels);
      if (pp.pieces.length <= MAX_PIECES) {
        const pref = prefRoll(W, rows, mat, pp.panels);
        for (const m of MODES) for (const o of ORDERS) len = Math.min(len, packStrip(W, withMode(pp.pieces, m, W, 1e9, pref), o));
      }
      if (!isFinite(len)) continue;
      len = Math.round(len * 100) / 100;
      const total = (len * W) / 1e4;
      tried.push({ W, len, total });
      if (!best || total < best.total - EPS || (total < best.total + EPS && len < best.len)) best = { W, len, total, panels: pp.panels };
    }
    if (!best) return { error: `Bleed and panel overlap leave no printable width on the ${matSize(mat)}` };
    return {
      ...best,
      use: best.len / 100,
      run: best.len / 100,
      tried,
      sizeTxt: rollTxt(best.W),
      useTxt: `${(best.len / 100).toFixed(2)} m of ${rollTxt(best.W)}`,
    };
  }
  function sheetGroup(mat: SqmMaterial, rows: OkRow[]) {
    const SW = +mat.width,
      SH = +mat.length,
      b = bleedOf(mat);
    if (!(SW > 0 && SH > 0)) return { error: 'Set the sheet size in Materials' };
    const fit = (a: number, c: number) => Math.floor((SW + EPS) / a) * Math.floor((SH + EPS) / c);
    const pieces: Piece[] = [],
      pref: Record<string, number[]> = {};
    let sheets = 0;
    for (const x of rows) {
      const pw = x.r.w + 2 * b,
        ph = x.r.h + 2 * b,
        per = Math.max(fit(pw, ph), fit(ph, pw));
      if (!per) return { error: `${x.it.name || 'An item'} (${x.r.w}×${x.r.h} cm) does not fit on a ${matSize(mat)}` };
      sheets += Math.ceil(x.r.q / per);
      pref[x.it.id] = fit(pw, ph) >= fit(ph, pw) ? [pw, ph] : [ph, pw];
      for (let i = 0; i < x.r.q; i++) pieces.push({ w: pw, h: ph, id: x.it.id });
    }
    if (pieces.length <= MAX_PIECES) for (const m of MODES) for (const o of ORDERS) sheets = Math.min(sheets, packSheets(SW, SH, withMode(pieces, m, SW, SH, pref), o));
    return { sheets, use: sheets, run: 0, total: (sheets * SW * SH) / 1e4, panels: {}, sizeTxt: matSize(mat), useTxt: sheetsTxt(sheets) };
  }

  const mats = Object.fromEntries(job.materials.map((m) => [m.id, m]));
  const stock = new Map<string, SqmStockGroup>();
  let errors = 0;
  const locs = job.locations.map((L) => {
    const rows: SqmRow[] = L.items.map((it) => ({ it, mat: mats[it.mat], r: itemBase(it, mats[it.mat]) }));
    rows.forEach((x) => {
      if ('error' in x.r) errors++;
    });
    const byMat = new Map<string, { mat: SqmMaterial; rows: OkRow[] }>();
    rows
      .filter((x): x is OkRow => 'real' in x.r)
      .forEach((x) => {
        const g = byMat.get(x.mat.id) || { mat: x.mat, rows: [] };
        g.rows.push(x);
        byMat.set(x.mat.id, g);
      });
    const groups: SqmGroup[] = [...byMat.values()].map((g) => {
      const real = g.rows.reduce((a, x) => a + x.r.real, 0),
        pcs = g.rows.reduce((a, x) => a + x.r.q, 0);
      const res = g.mat.kind === 'roll' ? rollGroup(g.mat, g.rows) : sheetGroup(g.mat, g.rows);
      if ('error' in res) {
        errors++;
        return { ...g, error: res.error, real, pcs, use: 0, run: 0, total: 0, waste: 0, panels: {}, sizeTxt: matSize(g.mat), useTxt: '' };
      }
      return { ...g, ...res, real, pcs, waste: res.total - real };
    });
    const ok = groups.filter((g) => !g.error),
      sum = (k: 'pcs' | 'run' | 'real' | 'waste' | 'total') => ok.reduce((a, g) => a + g[k], 0);
    ok.forEach((g) => {
      const k = g.mat.id + '|' + (g.W || 'sheet');
      const s = stock.get(k) || {
        key: k,
        mat: g.mat,
        W: g.W ?? null,
        sizeTxt: g.sizeTxt,
        entries: [],
        use: 0,
        real: 0,
        waste: 0,
        total: 0,
        pcs: 0,
        useTxt: '',
      };
      s.entries.push({ loc: L.name, g });
      s.use += g.use;
      s.real += g.real;
      s.waste += g.waste;
      s.total += g.total;
      s.pcs += g.pcs;
      stock.set(k, s);
    });
    return { L, rows, groups, items: ok.reduce((a, g) => a + g.rows.length, 0), pcs: sum('pcs'), run: sum('run'), real: sum('real'), waste: sum('waste'), total: sum('total') };
  });
  const tot = (k: 'items' | 'pcs' | 'run' | 'real' | 'waste' | 'total') => locs.reduce((a, l) => a + l[k], 0);
  const T = { items: tot('items'), pcs: tot('pcs'), run: tot('run'), real: tot('real'), waste: tot('waste'), total: tot('total') };
  const stockGroups = [...stock.values()].map((s) => ({ ...s, useTxt: useShort(s.mat, s.use) }));
  return { locs, T, stockGroups, errors };
}

export const sqmPct = (w: number, t: number) => (t > 0 ? ((w / t) * 100).toFixed(1) + '%' : '–');

/** The calculator's starting materials (same list as the standalone app). */
export const DEFAULT_SQM_MATERIALS: SqmMaterial[] = [
  { id: 'm1', name: 'Matte Banner', kind: 'roll', width: 320, length: 0, bleed: 10 },
  { id: 'm2', name: 'One Way Sticker', kind: 'roll', width: 107, length: 0, bleed: 3 },
  { id: 'm3', name: 'Glossy Sticker', kind: 'roll', width: 152, length: 0, bleed: 3 },
  { id: 'm4', name: 'Pull-up Material', kind: 'roll', width: 91, length: 0, bleed: 0 },
  { id: 'm5', name: 'Foamboard', kind: 'sheet', width: 122, length: 244, bleed: 0 },
  { id: 'm6', name: 'Frontlit Flex Banner', kind: 'roll', width: 320, length: 0, bleed: 10 },
  { id: 'm7', name: 'Backlit Flex Banner', kind: 'roll', width: 320, length: 0, bleed: 10 },
  { id: 'm8', name: 'Mesh Banner', kind: 'roll', width: 320, length: 0, bleed: 10 },
  { id: 'm9', name: 'Glossy Banner', kind: 'roll', width: 320, length: 0, bleed: 10 },
  { id: 'm10', name: 'Matte Sticker', kind: 'roll', width: 152, length: 0, bleed: 3 },
  { id: 'm11', name: 'Clear Sticker', kind: 'roll', width: 127, length: 0, bleed: 3 },
  { id: 'm12', name: 'Reflective Vinyl', kind: 'roll', width: 124, length: 0, bleed: 3 },
  { id: 'm13', name: 'Floor Graphic Vinyl', kind: 'roll', width: 137, length: 0, bleed: 3 },
  { id: 'm14', name: 'Backlit Film', kind: 'roll', width: 127, length: 0, bleed: 3 },
  { id: 'm15', name: 'Photo Paper', kind: 'roll', width: 127, length: 0, bleed: 0 },
  { id: 'm16', name: 'Canvas', kind: 'roll', width: 152, length: 0, bleed: 5 },
  { id: 'm17', name: 'Wallpaper', kind: 'roll', width: 107, length: 0, bleed: 3 },
  { id: 'm18', name: 'Fabric / Textile', kind: 'roll', width: 160, length: 0, bleed: 5 },
  { id: 'm19', name: 'PVC Forex Board 3 mm', kind: 'sheet', width: 122, length: 244, bleed: 0 },
  { id: 'm20', name: 'PVC Forex Board 5 mm', kind: 'sheet', width: 122, length: 244, bleed: 0 },
  { id: 'm21', name: 'Acrylic Sheet', kind: 'sheet', width: 122, length: 244, bleed: 0 },
  { id: 'm22', name: 'Correx Board', kind: 'sheet', width: 122, length: 244, bleed: 0 },
  { id: 'm23', name: 'Aluminium Composite (ACP)', kind: 'sheet', width: 122, length: 244, bleed: 0 },
];

/** First Choice's starting list (same as supabase/migrations/0004_sqm.sql), roll widths matched to stock. */
export const FCA_SQM_MATERIALS: SqmMaterial[] = (
  [
    ['m3', 'Glossy Sticker', 'roll', '152, 127, 107', 152, 0, 3],
    ['m10', 'Matte Sticker', 'roll', '152, 127, 107', 152, 0, 3],
    ['m11', 'Clear Sticker', 'roll', '127', 127, 0, 3],
    ['m2', 'One Way Sticker', 'roll', '152, 127', 152, 0, 3],
    ['m24', 'Frosty Sticker', 'roll', '152, 127', 152, 0, 3],
    ['m12', 'Reflective Vinyl', 'roll', '127', 127, 0, 3],
    ['m17', 'Wallpaper', 'roll', '127', 127, 0, 3],
    ['m14', 'Backlit Film', 'roll', '127', 127, 0, 3],
    ['m4', 'Pull-up Material', 'roll', '95', 95, 0, 0],
    ['m16', 'Canvas', 'roll', '152', 152, 0, 5],
    ['m9', 'Glossy Banner', 'roll', '320', 320, 0, 10],
    ['m1', 'Matte Banner', 'roll', '320', 320, 0, 10],
    ['m7', 'Backlit Flex Banner', 'roll', '320', 320, 0, 10],
    ['m8', 'Mesh Banner', 'roll', '320', 320, 0, 10],
    ['m18', 'Fabric / Textile', 'roll', '320, 160', 320, 0, 5],
    ['m6', 'Frontlit Flex Banner', 'roll', '320', 320, 0, 10],
    ['m13', 'Floor Graphic Vinyl', 'roll', '137', 137, 0, 3],
    ['m15', 'Photo Paper', 'roll', '127', 127, 0, 0],
    ['m5', 'Foamboard 5 mm', 'sheet', '', 122, 244, 0],
    ['m25', 'Foamboard 15 mm', 'sheet', '', 122, 244, 0],
    ['m26', 'ABS Sheet 1 mm', 'sheet', '', 122, 244, 0],
    ['m21', 'Acrylic Sheet 3 mm', 'sheet', '', 122, 244, 0],
    ['m27', 'Acrylic Sheet 5 mm', 'sheet', '', 122, 244, 0],
    ['m19', 'PVC Forex Board 3 mm', 'sheet', '', 122, 244, 0],
    ['m20', 'PVC Forex Board 5 mm', 'sheet', '', 122, 244, 0],
    ['m22', 'Correx Board', 'sheet', '', 122, 244, 0],
    ['m23', 'Aluminium Composite (ACP)', 'sheet', '', 122, 244, 0],
  ] as const
).map(([id, name, kind, widths, width, length, bleed]) => ({ id, name, kind, widths, width, length, bleed, overlap: 2, links: {} }));

// ---------------------------------------------------------------- stock link


/** Other words the same material goes by in the stock list. */
const ALIASES: [RegExp, string][] = [
  [/one\s*way/i, 'owv'],
  [/pull-?\s*up/i, 'pet pull up'],
  [/backlit\s+flex/i, 'backlite'],
  [/backlit\s+film/i, 'translite'],
  [/reflective/i, 'reflective'],
  [/wall\s*paper/i, 'wallpaper pp paper'],
  [/fabric|textile/i, 'fabric teardrop'],
  [/foam\s*board/i, 'foam'],
  [/acrylic/i, 'arcylic acrylic clear'],
  [/glossy\s+banner/i, 'flexi'],
  [/matte\s+banner/i, 'flexi'],
  [/frontlit/i, 'flexi glossy'],
];
const GENERIC = new Set(['sticker', 'banner', 'sheet', 'material', 'board', 'roll', 'mm', 'vinyl', 'flex', 'film', 'paper']);

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/**
 * The stock item a material (at roll width W cm, or as a sheet) is most likely taken from,
 * or null. Rolls must match the width; sheets with a thickness ("5 mm") must match it.
 */
export function suggestStockItem(mat: SqmMaterial, W: number | null, items: Item[]): Item | null {
  const aliases = ALIASES.filter(([re]) => re.test(mat.name)).map(([, a]) => a).join(' ');
  const want = [...new Set(words(`${mat.name} ${aliases}`))].filter((w) => !/^\d/.test(w));
  const key = want.filter((w) => !GENERIC.has(w));
  const thick = /(\d+(?:\.\d+)?)\s*mm/i.exec(mat.name)?.[1];
  let best: Item | null = null;
  let bestScore = 0;
  for (const i of items) {
    if (!i.active) continue;
    if (mat.kind === 'roll') {
      const size = parseRollSize(i.size);
      if (i.unit !== 'Rolls' || !size || W == null || Math.abs(size.width * 100 - W) > 0.6) continue;
    } else {
      if (i.unit !== 'Sheets') continue;
      if (thick && !new RegExp(`(^|[^0-9.])${thick}\\s*MM`, 'i').test(i.size)) continue;
    }
    const have = words(i.name);
    const hit = (w: string) => have.some((h) => h === w || (w.length >= 4 && h.startsWith(w.slice(0, 4))));
    if (!key.some(hit)) continue;
    const score = want.filter(hit).length - have.filter((h) => !want.some((w) => h === w || h.startsWith(w.slice(0, 4)))).length * 0.1;
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  return best;
}

export interface TakeLine {
  key: string;
  label: string; // e.g. "Glossy Sticker, 1.27 m roll"
  useTxt: string; // e.g. "4.84 m" or "3 sheets"
  item_id: string | null;
  /** quantity in the stock item's unit (rolls may be fractional) */
  qty: number;
  metres: number | null;
}

/** Converts "stock to pull" into stock-out lines, using saved links or a suggested item. */
export function takeLines(result: SqmResult, items: Item[]): TakeLine[] {
  return result.stockGroups.map((s) => {
    const linkKey = s.W != null ? String(s.W) : 'sheet';
    const linked = s.mat.links?.[linkKey];
    const item = items.find((i) => i.id === linked && i.active) ?? suggestStockItem(s.mat, s.W, items);
    return { key: s.key, label: `${s.mat.name}, ${s.sizeTxt}`, useTxt: s.useTxt, ...qtyFor(s, item) };
  });
}

/** How much of `item` a stock-to-pull line uses: metres → rolls by the item's roll length; sheets as counted. */
export function qtyFor(s: Pick<SqmStockGroup, 'mat' | 'use'>, item: Item | null | undefined): { item_id: string | null; qty: number; metres: number | null } {
  if (!item) return { item_id: null, qty: 0, metres: s.mat.kind === 'roll' ? Math.round(s.use * 100) / 100 : null };
  if (s.mat.kind === 'roll') {
    const metres = Math.round(s.use * 100) / 100;
    const len = parseRollSize(item.size)?.length;
    return { item_id: item.id, qty: len ? Math.round((metres / len) * 10000) / 10000 : metres, metres };
  }
  return { item_id: item.id, qty: s.use, metres: null };
}

// ---------- report wording (same text as the standalone app's PDF) ----------

export const sqmF2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** "3 panels of 120 × 300 cm each" for an item wider than the roll, else ''. */
export function sqmPanelTxt(g: SqmGroup | undefined, itemId: string): string {
  const P = g?.panels?.[itemId];
  return P ? `${P.n} panels of ${r1(P.pw)} × ${r1(P.along)} cm each` : '';
}

export function sqmBleedTxt(job: Pick<SqmJob, 'bleedMode' | 'bleedCm'>): string {
  return job.bleedMode === 'custom'
    ? `Added, ${+(job.bleedCm ?? 0) || 0} cm on every side`
    : job.bleedMode === 'yes'
      ? "Added, using each material's bleed"
      : 'Not added (sizes include bleed)';
}

export function sqmNotes(job: Pick<SqmJob, 'bleedMode' | 'bleedCm'>): string {
  return `Real SQM is the finished size of each piece. Items of the same material in one location are laid out together on one roll or set of sheets, so running m, total and wastage are given per material. Where a material comes in several roll widths, the width with the least wastage is used. Wastage SQM is offcuts${job.bleedMode !== 'no' ? ' plus bleed' : ''}. Items wider than the roll are printed in panels; the panel overlap counts as wastage. Bleed: ${sqmBleedTxt(job).toLowerCase()}.`;
}

export const sqmUseShort = useShort;

/** "12 November 2026", as the report writes dates (and reads them back). */
export function sqmDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(+d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
