// Quick add for the job calculator: reads items from typed or pasted text,
// e.g. "Window sticker, 90x120 cm - 4 pcs" or cells pasted from Excel.
// Same rules as the standalone SQM & Wastage Calculator.

import { widthsOf, type SqmMaterial } from './sqm.ts';

const NUM = '(\\d+(?:[.,]\\d+)?)',
  UNIT = '\\s*(mm|cm|m|in|")?';
const DIM_RE = new RegExp(NUM + UNIT + '\\s*[x×*]\\s*' + NUM + UNIT + '(?![a-z])', 'i');
const QTY_RE = /(\d+)\s*(?:pcs|pc|pieces?|nos?\.?|units?|sets?)(?![a-z])|(?:qty|quantity)\s*[:=]?\s*(\d+)|[x×]\s*(\d+)\s*$/i;
const A_SIZES: Record<string, [number, number]> = { 0: [84.1, 118.9], 1: [59.4, 84.1], 2: [42, 59.4], 3: [29.7, 42], 4: [21, 29.7], 5: [14.8, 21] };
const toNum = (s: string) => +String(s).replace(',', '.');
const toCm = (v: number, u?: string) => v * (({ mm: 0.1, cm: 1, m: 100, in: 2.54, '"': 2.54 } as Record<string, number>)[String(u || 'cm').toLowerCase()] ?? 1);
const guessUnit = (a: number, b: number) => (Math.max(a, b) <= 10 ? 'm' : 'cm');
const r1 = (n: number) => Math.round(n * 10) / 10;

const stem = (w: string) => w.slice(0, 5);
const wordsOf = (t: string): string[] => String(t || '').toLowerCase().match(/[a-z]+/g) || [];
const MAT_TYPES = ['sticker', 'vinyl', 'banner', 'flex', 'mesh', 'canvas', 'film', 'fabric', 'paper', 'board'];
const FINISHES = ['frost', 'frosty', 'frosted', 'matt', 'matte', 'gloss', 'glossy', 'clear', 'transparent', 'white', 'black', 'reflective', 'perforated', 'satin', 'metallic', 'gold', 'silver', 'mirror', 'blockout', 'backlit', 'frontlit', 'translucent', 'opaque', 'sandblast', 'sandblasted', 'etched', 'holographic', 'magnetic', 'luminous', 'fluorescent', 'textured', 'coloured', 'colored'];
const FIND_NEW_RE = new RegExp('\\b(' + FINISHES.join('|') + ')\\s+(' + MAT_TYPES.join('|') + ')s?\\b', 'i');
const cap = (w: string) => w[0].toUpperCase() + w.slice(1).toLowerCase();

export type FoundMaterial = { create?: false; id: string; name: string; words: string[] } | { create: true; name: string; words: string[] };

/**
 * The material a piece of text names. A material in the list wins when all its words appear
 * (spelling variants such as frosty/frosted count). Otherwise a finish word plus a material
 * type, such as "Frosty Sticker", names a material that is not in the list yet.
 */
export function findMaterial(text: string, materials: SqmMaterial[]): FoundMaterial | null {
  const ts = new Set(wordsOf(text).map(stem));
  let best: { id: string; name: string; words: string[]; score: number } | null = null;
  materials.forEach((m, i) => {
    const mw = wordsOf(m.name).filter((w) => w.length > 1);
    if (!mw.length || !mw.every((w) => ts.has(stem(w)))) return;
    const score = mw.length * 10 - i * 0.001;
    if (!best || score > best.score) best = { id: m.id, name: m.name, words: mw, score };
  });
  if (best) {
    const b = best as { id: string; name: string; words: string[] };
    return { id: b.id, name: b.name, words: b.words };
  }
  const m = FIND_NEW_RE.exec(String(text || ''));
  return m ? { create: true, name: cap(m[1]) + ' ' + cap(m[2]), words: [m[1].toLowerCase(), m[2].toLowerCase()] } : null;
}

/** The material with this name, or a new one copied from the widest material of the same type. */
export function materialFor(name: string, materials: SqmMaterial[], newId: () => string): { mat: SqmMaterial; isNew: boolean } {
  const key = (n: string) => wordsOf(n).map(stem).sort().join(' ');
  const have = materials.find((m) => key(m.name) === key(name));
  if (have) return { mat: have, isNew: false };
  const type = wordsOf(name).pop() || '';
  const same = materials.filter((m) => wordsOf(m.name).includes(type)).sort((a, b) => (widthsOf(b)[0] || 0) - (widthsOf(a)[0] || 0));
  const base: Partial<SqmMaterial> = same[0] || materials.find((m) => m.kind === 'roll') || { kind: 'roll', width: 152, bleed: 3 };
  return {
    mat: { id: newId(), name, kind: base.kind ?? 'roll', width: base.width ?? 152, widths: base.widths, length: base.length || 0, bleed: base.bleed ?? 0, overlap: base.overlap ?? 2 },
    isNew: true,
  };
}

function stripMaterial(name: string, words: string[]) {
  const ws = new Set(words.map(stem));
  const left = String(name)
    .split(/\s+/)
    .filter((t) => !ws.has(stem(t.toLowerCase().replace(/[^a-z]/g, ''))))
    .join(' ')
    .trim();
  return left || name;
}

function guessMaterial(text: string, materials: SqmMaterial[]) {
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  let best: { id: string; score: number } | null = null;
  materials.forEach((m, i) => {
    const mw = (m.name.toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2);
    const hit = mw.filter((w) => words.some((t) => t.length >= 4 && (w.startsWith(t) || t.startsWith(w)))).length;
    if (!hit) return;
    const score = hit * 10 + (hit / mw.length) * 5 - i * 0.001;
    if (!best || score > best.score) best = { id: m.id, score };
  });
  return (best as { id: string } | null)?.id;
}

export type ParsedLine =
  | { raw: string; error: string }
  | { raw: string; name: string; w: number; h: number; qty: number; mat?: string; newMat: string | null; unitNote: string };

export function parseLine(raw: string, materials: SqmMaterial[]): ParsedLine | null {
  const flat = raw.replace(/\t+/g, '  ').trim();
  if (!flat) return null;
  let w: number | null = null,
    h: number | null = null,
    unitNote = '',
    rest = flat,
    qty: number | null = null;
  const d = DIM_RE.exec(flat);
  if (d) {
    const a = toNum(d[1]),
      b = toNum(d[3]),
      u = d[2] || d[4] || guessUnit(a, b);
    if (!d[2] && !d[4]) unitNote = `no unit, read as ${u}`;
    w = toCm(a, d[2] || u);
    h = toCm(b, d[4] || u);
    rest = flat.slice(0, d.index) + ' ' + flat.slice(d.index + d[0].length);
  } else {
    const am = /\bA([0-5])\b/i.exec(flat);
    if (am) {
      [w, h] = A_SIZES[am[1]];
      rest = flat.replace(am[0], ' ');
    }
  }
  const qm = QTY_RE.exec(rest);
  if (qm) {
    qty = +(qm[1] || qm[2] || qm[3]);
    rest = rest.replace(qm[0], ' ');
  }
  if (w == null) {
    // No "x": the first two numbers are width and height, a third is the quantity (spreadsheet rows).
    const nums: [number, string | undefined][] = [],
      words: string[] = [];
    rest
      .split(/\s+/)
      .filter(Boolean)
      .forEach((t) => {
        const m = /^(\d+(?:[.,]\d+)?)(mm|cm|m)?$/i.exec(t.replace(/[,;:\-–]+$/, ''));
        if (m) nums.push([toNum(m[1]), m[2]]);
        else words.push(t);
      });
    if (nums.length < 2) return { raw, error: 'no size found (write it like 2x3m or 120 x 400 cm)' };
    const [[a, ua], [b, ub]] = nums,
      u = ua || ub || guessUnit(a, b);
    if (!ua && !ub) unitNote = `no unit, read as ${u}`;
    w = toCm(a, ua || u);
    h = toCm(b, ub || u);
    if (qty == null && nums[2]) qty = Math.round(nums[2][0]);
    rest = words.join(' ');
  } else if (qty == null) {
    const lone = /(?:^|[\s\-–,:])(\d+)\s*$/.exec(rest.trim());
    if (lone) {
      qty = +lone[1];
      rest = rest.trim().slice(0, lone.index);
    }
  }
  const fm = findMaterial(flat, materials);
  const mat = fm ? (fm.create ? undefined : fm.id) : guessMaterial(flat, materials),
    newMat = fm && fm.create ? fm.name : null;
  let name = rest
    .replace(/(^|\s)[,;:|\-–]+(?=\s|$)/g, ' ')
    .replace(/[,;:|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (fm && name) name = stripMaterial(name, fm.words);
  name = name || newMat || materials.find((m) => m.id === mat)?.name || '';
  if (!(w! > 0 && h! > 0)) return { raw, error: 'size must be more than 0' };
  return { raw, name, w: r1(w!), h: r1(h!), qty: Math.max(1, qty || 1), mat, newMat, unitNote };
}

export const parseItemsText = (text: string, materials: SqmMaterial[]) =>
  String(text || '')
    .split(/\r?\n|;/)
    .map((l) => parseLine(l, materials))
    .filter((x): x is ParsedLine => !!x);
