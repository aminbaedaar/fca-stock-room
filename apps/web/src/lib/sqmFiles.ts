// Files for the job calculator:
// - readArtwork: the print size of artwork files (PDF, Illustrator, EPS, SVG, JPG/PNG/TIFF with dpi),
//   read on this device. (The standalone app could also ask Claude to read sizes written in a
//   picture; that is left out here, so such pictures come in without a size to type in.)
// - readReport: a job back from an SQM & Wastage PDF report.

import type { SqmJobPayload } from './sqmPdf';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsP: Promise<any> | null = null;
function pdfjs() {
  return (pdfjsP ||= (async () => {
    const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.js?url')]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })().catch((e) => {
    pdfjsP = null;
    throw e;
  }));
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const str = (u: Uint8Array, s: number, n: number) => String.fromCharCode(...u.subarray(s, s + n));

function tiffDpi(u: Uint8Array, t: number): [number, number] | null {
  const le = u[t] === 0x49;
  const r16 = (o: number) => (le ? u[o] | (u[o + 1] << 8) : (u[o] << 8) | u[o + 1]);
  const r32 = (o: number) => (le ? u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24) : (u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0;
  const ifd = t + r32(t + 4);
  if (ifd + 2 > u.length) return null;
  let x: number | null = null,
    y: number | null = null,
    unit = 2;
  for (let k = 0, n = r16(ifd); k < n; k++) {
    const e = ifd + 2 + k * 12,
      tag = r16(e);
    if (tag === 0x11a || tag === 0x11b) {
      const o = t + r32(e + 8),
        d = r32(o + 4);
      const v = d ? r32(o) / d : 0;
      if (tag === 0x11a) x = v;
      else y = v;
    }
    if (tag === 0x128) unit = r16(e + 8);
  }
  if (!x || unit === 1) return null;
  const f = unit === 3 ? 2.54 : 1;
  return [x * f, (y || x) * f];
}
function jpegDpi(u: Uint8Array) {
  let i = 2,
    jfif: [number, number] | null = null,
    exif: [number, number] | null = null;
  while (i + 4 < u.length && u[i] === 0xff) {
    const m = u[i + 1],
      len = (u[i + 2] << 8) | u[i + 3],
      s = i + 4;
    if (m === 0xda || m === 0xd9) break;
    if (m === 0xe0 && str(u, s, 5) === 'JFIF\0') {
      const unit = u[s + 7],
        x = (u[s + 8] << 8) | u[s + 9],
        y = (u[s + 10] << 8) | u[s + 11];
      if (unit === 1) jfif = [x, y];
      else if (unit === 2) jfif = [x * 2.54, y * 2.54];
    }
    if (m === 0xe1 && str(u, s, 6) === 'Exif\0\0') {
      try {
        exif = tiffDpi(u, s + 6);
      } catch {
        /* no dpi */
      }
    }
    i += 2 + len;
  }
  return exif || jfif;
}
function pngDpi(u: Uint8Array): [number, number] | null {
  const r32 = (o: number) => ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0;
  for (let i = 8; i + 8 < u.length; ) {
    const len = r32(i),
      type = str(u, i + 4, 4);
    if (type === 'pHYs' && u[i + 16] === 1) return [r32(i + 8) * 0.0254, r32(i + 12) * 0.0254];
    if (type === 'IDAT' || type === 'IEND') break;
    i += 12 + len;
  }
  return null;
}
const svgLen = (v: string | null) => {
  const m = /^\s*([\d.]+)\s*(mm|cm|in|pt)\s*$/.exec(v || '');
  if (!m) return null;
  return +m[1] * ({ mm: 0.1, cm: 1, in: 2.54, pt: 2.54 / 72 } as Record<string, number>)[m[2]];
};
function thumbOf(src: CanvasImageSource, w: number, h: number) {
  const s = 96 / Math.max(w, h),
    c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}
const cleanName = (f: File) => f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

export interface Artwork {
  name: string;
  w?: number;
  h?: number;
  thumb: string;
  note: string;
  /** No print size in the file: the size must be typed in. */
  noSize?: boolean;
}

export async function readArtwork(file: File): Promise<Artwork[]> {
  const buf = await file.arrayBuffer(),
    u = new Uint8Array(buf),
    name = cleanName(file);
  // Illustrator files saved "PDF compatible" (the default) are PDFs inside; older .ai and .eps carry a PostScript bounding box.
  const isPdf = str(u, 0, 4) === '%PDF',
    isPs = /\.(ai|eps|epsf|ps)$/i.test(file.name) || /postscript|illustrator/.test(file.type);
  if (isPs && !isPdf) {
    let s = 0;
    if (u[0] === 0xc5 && u[1] === 0xd0 && u[2] === 0xd3 && u[3] === 0xc6) s = (u[4] | (u[5] << 8) | (u[6] << 16) | (u[7] << 24)) >>> 0;
    const head = new TextDecoder('latin1').decode(u.subarray(s, s + 262144));
    const m = /%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(head) || /%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(head);
    if (!m) throw new Error(`${file.name}: no artboard size found. In Illustrator, save with "Create PDF Compatible File" ticked, or export a PDF.`);
    const w = r1(((+m[3] - +m[1]) / 72) * 2.54),
      h = r1(((+m[4] - +m[2]) / 72) * 2.54);
    return [{ name, w, h, thumb: '', note: `Size from ${/\.ai$/i.test(file.name) ? 'Illustrator' : 'EPS'} file: ${w} × ${h} cm` }];
  }
  if (isPdf || file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const lib = await pdfjs(),
      pdf = await lib.getDocument({ data: buf }).promise,
      out: Artwork[] = [];
    const kindTxt = /\.ai$/i.test(file.name) ? 'Illustrator artboard' : 'PDF page';
    for (let p = 1; p <= Math.min(pdf.numPages, 20); p++) {
      const page = await pdf.getPage(p),
        [x0, y0, x1, y1] = page.view,
        uu = page.userUnit || 1;
      let wpt = (x1 - x0) * uu,
        hpt = (y1 - y0) * uu;
      if (page.rotate % 180) [wpt, hpt] = [hpt, wpt];
      const vp = page.getViewport({ scale: 200 / Math.max(wpt / uu, hpt / uu) }),
        c = document.createElement('canvas');
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const w = r1((wpt / 72) * 2.54),
        h = r1((hpt / 72) * 2.54);
      out.push({ name: pdf.numPages > 1 ? `${name} p${p}` : name, w, h, thumb: thumbOf(c, c.width, c.height), note: `Size from ${kindTxt}: ${w} × ${h} cm` });
    }
    return out;
  }
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    const el = new DOMParser().parseFromString(new TextDecoder().decode(u), 'image/svg+xml').documentElement;
    const w = svgLen(el.getAttribute('width')),
      h = svgLen(el.getAttribute('height'));
    const img = new Image(),
      url = URL.createObjectURL(file);
    await new Promise((ok) => {
      img.onload = img.onerror = ok;
      img.src = url;
    });
    const thumb = img.naturalWidth ? thumbOf(img, img.naturalWidth, img.naturalHeight) : '';
    URL.revokeObjectURL(url);
    return [w && h ? { name, w: r1(w), h: r1(h), thumb, note: `Size from SVG: ${r1(w)} × ${r1(h)} cm` } : { name, thumb, noSize: true, note: 'No print size in this SVG. Enter the size.' }];
  }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} can't be opened here. Export it as JPG, PNG or PDF.`);
  }
  const dpi = u[0] === 0xff && u[1] === 0xd8 ? jpegDpi(u) : u[0] === 0x89 && u[1] === 0x50 ? pngDpi(u) : null;
  const thumb = thumbOf(bmp, bmp.width, bmp.height);
  // Screenshots carry the screen's dpi, not a print size.
  const isShot = /screen ?shot|screenshot|pasted|capture|snip|^image$/i.test(name);
  if (dpi && dpi[0] >= 10 && dpi[1] >= 10 && !isShot) {
    const w = r1((bmp.width / dpi[0]) * 2.54),
      h = r1((bmp.height / dpi[1]) * 2.54);
    return [{ name, w, h, thumb, note: `Size from file: ${bmp.width} × ${bmp.height} px at ${Math.round(dpi[0])} dpi` }];
  }
  return [{ name, thumb, noSize: true, note: 'No print size in this picture. Enter the size, or type the items in the box below.' }];
}

/** A job read back from a report: either the exact job stored inside, or rebuilt from the report text. */
export type ReportJob = Omit<SqmJobPayload, 'v' | 'locations'> & {
  locations: { name: string; items: { name: string; mat?: string; matName?: string; rollW?: number | null; w: number | string; h: number | string; qty: number | string }[] }[];
};

export async function readReport(file: File): Promise<ReportJob | null> {
  const buf = await file.arrayBuffer();
  const raw = new TextDecoder('latin1').decode(new Uint8Array(buf));
  const m = /SQMJOB1:([A-Za-z0-9+/=]+)/.exec(raw);
  if (m) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    } catch {
      /* fall back to the text */
    }
  }
  return jobFromReportText(buf);
}

// Older reports are read back from the report's own text.
async function jobFromReportText(buf: ArrayBuffer): Promise<ReportJob | null> {
  const lib = await pdfjs(),
    pdf = await lib.getDocument({ data: buf.slice(0) }).promise,
    lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent(),
      rows: { y: number; parts: { x: number; s: string }[] }[] = [];
    tc.items.forEach((it: { str?: string; transform: number[] }) => {
      if (!it.str || !it.str.trim()) return;
      const y = it.transform[5];
      let r = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (!r) {
        r = { y, parts: [] };
        rows.push(r);
      }
      r.parts.push({ x: it.transform[4], s: it.str });
    });
    rows
      .sort((a, b) => b.y - a.y)
      .forEach((r) =>
        lines.push(
          r.parts
            .sort((a, b) => a.x - b.x)
            .map((q) => q.s)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim(),
        ),
      );
  }
  if (!lines.some((l) => /SQM & Wastage Report/.test(l))) return null;
  const val = (k: string) => {
    const l = lines.find((l) => l.toUpperCase().startsWith(k));
    const v = l ? l.slice(k.length).trim() : '';
    return v === '–' ? '' : v;
  };
  const MON = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const dm = /^(\d{1,2}) ([a-z]+) (\d{4})$/i.exec(val('DATE')),
    mi = dm ? MON.indexOf(dm[2].toLowerCase()) : -1;
  const bl = val('BLEED'),
    bc = /([\d.]+) cm on every side/.exec(bl);
  const job: ReportJob = {
    job: val('BRAND / JOB'),
    client: val('CLIENT'),
    by: val('PREPARED BY'),
    date: dm && mi >= 0 ? `${dm[3]}-${String(mi + 1).padStart(2, '0')}-${dm[1].padStart(2, '0')}` : '',
    bleedMode: bc ? 'custom' : /^Added/i.test(bl) ? 'yes' : 'no',
    bleedCm: bc ? +bc[1] : '',
    materials: [],
    locations: [],
  };
  const start = lines.findIndex((l) => /^# Item/.test(l));
  if (start < 0) return job;
  type It = ReportJob['locations'][number]['items'][number];
  let loc: ReportJob['locations'][number] | null = null,
    pending: It[] = [],
    last: It | null = null,
    expectLoc = true;
  for (const l of lines.slice(start + 1)) {
    if (/^Job total|^Notes$/.test(l)) break;
    if (/^# Item|SQM & Wastage Report|Page \d+ of \d+$|^Summary by item/.test(l)) continue;
    // second line of a wrapped column heading, or a size cell's lone "cm"
    if (/^(?:sheets|SQM|Real|Wastage|Total|Waste|Running|m|\/|%|cm|\s)+$/i.test(l)) continue;
    if (/^Subtotal/.test(l)) {
      expectLoc = true;
      pending = [];
      last = null;
      continue;
    }
    const it = /^(\d+) (.*?) ?(\d+(?:\.\d+)?) ?× ?(\d+(?:\.\d+)?)(?: ?cm)? (\d+) [\d.]+$/.exec(l);
    if (it) {
      if (!loc) {
        loc = { name: '', items: [] };
        job.locations.push(loc);
      }
      last = { name: it[2].trim(), matName: '', w: +it[3], h: +it[4], qty: +it[5] };
      loc.items.push(last);
      pending.push(last);
      expectLoc = false;
      continue;
    }
    const mat = /^([^\d].*?) · (.*)$/.exec(l);
    if (mat) {
      const rw = /of ([\d.]+)/.exec(mat[2]);
      pending.forEach((x) => {
        x.matName = mat[1].trim();
        x.rollW = rw ? +rw[1] * 100 : null;
      });
      pending = [];
      last = null;
      continue;
    }
    if (/^\d+ panels of|^m roll|^\(?[\d.]* ?m roll\)?$|^[\d.\s%m]+$/.test(l)) continue;
    if (expectLoc) {
      loc = { name: l === 'Unnamed location' ? '' : l, items: [] };
      job.locations.push(loc);
      expectLoc = false;
      pending = [];
      last = null;
      continue;
    }
    if (last) last.name += ' ' + l.replace(/ ?cm$/, '');
  }
  job.locations.forEach((L) => {
    L.items = L.items.filter((x) => x.matName);
  });
  return job;
}
