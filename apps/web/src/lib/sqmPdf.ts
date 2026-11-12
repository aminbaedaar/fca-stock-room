// The SQM & Wastage PDF report: the same two-page First Choice report as the
// standalone calculator (logo, job details, summary tiles, summary by item,
// notes, and "Material to pull from stock" on its own page).
// The job rides inside the PDF so "Open PDF report" can bring it back exactly.

import { computeSqm, sqmDate, sqmBleedTxt, sqmF2 as f2, sqmNotes, sqmPanelTxt, sqmPct as pct, sqmUseShort, type SqmJob, type SqmMaterial } from '@fca/core';

export interface SqmJobPayload {
  v: 1;
  job: string;
  client: string;
  by: string;
  date: string;
  bleedMode: SqmJob['bleedMode'];
  bleedCm: SqmJob['bleedCm'];
  materials: SqmMaterial[];
  locations: { name: string; items: { name: string; mat: string; w: number | string; h: number | string; qty: number | string }[] }[];
}

export function jobPayload(job: SqmJob): SqmJobPayload {
  const used = new Set(job.locations.flatMap((L) => L.items.map((i) => i.mat)));
  return {
    v: 1,
    job: job.job,
    client: job.client,
    by: job.by,
    date: job.date,
    bleedMode: job.bleedMode,
    bleedCm: job.bleedCm,
    // links are this company's stock items: not needed to re-open a job
    materials: job.materials.filter((m) => used.has(m.id)).map(({ links: _links, ...m }) => m),
    locations: job.locations.map((L) => ({ name: L.name, items: L.items.map((i) => ({ name: i.name, mat: i.mat, w: i.w, h: i.h, qty: i.qty })) })),
  };
}

export function sqmFileName(job: Pick<SqmJob, 'job' | 'client' | 'date'>) {
  const slug =
    (job.job || job.client || 'Job')
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'Job';
  return `SQM-Wastage-${slug}-${job.date || new Date().toISOString().slice(0, 10)}.pdf`;
}

type Logo = { src: string; r: number };
async function loadLogo(url: string, fallback: number): Promise<Logo> {
  try {
    const blob = await (await fetch(url)).blob();
    const src = await new Promise<string>((ok, no) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.onerror = no;
      fr.readAsDataURL(blob);
    });
    const img = new Image();
    await new Promise((ok) => {
      img.onload = img.onerror = ok;
      img.src = src;
    });
    return { src, r: img.naturalWidth ? img.naturalWidth / img.naturalHeight : fallback };
  } catch {
    return { src: '', r: fallback };
  }
}

type Cell = string | number | { content: string | number; colSpan?: number; styles?: Record<string, unknown> };
type BodyRow = Cell[] & { _grp?: 1; _sub?: 1; _mat?: 1 };

export async function buildSqmPdf(job: SqmJob): Promise<Blob> {
  const [{ jsPDF }, autoTableMod, MARK, WORD] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogo('/sqm-mark.png', 449 / 425),
    loadLogo('/sqm-wordmark.png', 1033 / 270),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const C = computeSqm(job),
    { T } = C;
  const M = 16,
    PW = 210,
    PH = 297;
  type RGB = [number, number, number];
  const INK: RGB = [27, 35, 33],
    MUT: RGB = [107, 119, 116],
    LINE: RGB = [221, 214, 218];
  // First Choice brand colours, sampled from the logo
  const ORANGE: RGB = [213, 80, 43],
    PURPLE: RGB = [89, 37, 84],
    WARM: RGB = [251, 242, 237],
    BAND: RGB[] = [
      [236, 178, 46],
      [227, 134, 46],
      [213, 80, 43],
      [189, 34, 82],
      [105, 40, 97],
      [89, 37, 84],
    ];
  const by = job.by || '',
    dateTxt = sqmDate(job.date);
  const tblStyle = {
    theme: 'plain' as const,
    styles: { font: 'helvetica', fontSize: 8, textColor: INK, cellPadding: { top: 1.8, bottom: 1.8, left: 1.6, right: 1.6 }, lineColor: [232, 226, 229] as RGB },
    headStyles: { fontStyle: 'bold' as const, textColor: PURPLE, lineWidth: { bottom: 0.5 }, lineColor: PURPLE },
    bodyStyles: { lineWidth: { bottom: 0.15 } },
  };
  const img = (L: Logo, x: number, y: number, h: number) => {
    if (L.src)
      try {
        doc.addImage(L.src, 'PNG', x, y, h * L.r, h);
      } catch {
        /* logo missing: carry on */
      }
    return h * L.r;
  };
  const band = (y: number, h: number, x0 = 0, x1 = PW) => {
    const w = (x1 - x0) / BAND.length;
    BAND.forEach((c, i) => {
      doc.setFillColor(...c);
      doc.rect(x0 + i * w, y, w + 0.05, h, 'F');
    });
  };

  // page 1: logo, title, colour band
  band(0, 3);
  const mw = img(MARK, M, 10, 19);
  img(WORD, M + mw + 4, 14, 11);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...PURPLE);
  doc.text('SQM & Wastage Report', PW - M, 19, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...ORANGE);
  doc.text(dateTxt, PW - M, 25, { align: 'right' });
  band(33, 0.8, M, PW - M);
  // job details on a warm panel
  const meta: [string, string][] = [
    ['Brand / job', job.job || '–'],
    ['Client', job.client || '–'],
    ['Locations', job.locations.map((L) => L.name).filter(Boolean).join(', ') || '–'],
    ['Prepared by', by || '–'],
    ['Date', dateTxt],
    ['Bleed', sqmBleedTxt(job)],
  ];
  doc.setFontSize(9.5);
  const metaLines = meta.map(([k, v]) => [k, doc.splitTextToSize(v, PW - 2 * M - 38) as string[]] as const);
  const metaH = metaLines.reduce((a, [, l]) => a + 5.2 * l.length, 0) + 5;
  doc.setFillColor(...WARM);
  doc.roundedRect(M, 39, PW - 2 * M, metaH, 2, 2, 'F');
  let y = 45;
  metaLines.forEach(([k, lines]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PURPLE);
    doc.text(k.toUpperCase(), M + 4, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(lines, M + 34, y);
    y += 5.2 * lines.length;
  });
  y = 39 + metaH + 10;

  // pages 2+: small logo and a thin band
  const runHead = () => {
    band(0, 2);
    const w = img(MARK, M, 6, 8);
    img(WORD, M + w + 2.5, 8, 4.6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...PURPLE);
    doc.text('SQM & Wastage Report', PW - M, 11.5, { align: 'right' });
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(M, 17, PW - M, 17);
  };
  const heading = (t: string) => {
    if (y > 255) {
      doc.addPage();
      runHead();
      y = 28;
    }
    doc.setFillColor(...ORANGE);
    doc.rect(M, y - 3.6, 1.3, 4.6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...PURPLE);
    doc.text(t, M + 3.5, y);
    y += 3;
  };

  heading('Summary');
  y += 2;
  const tw = (PW - 2 * M - 4 * 3) / 5;
  (
    [
      ['REAL SQM', f2(T.real)],
      ['WASTAGE SQM', f2(T.waste)],
      ['TOTAL SQM', f2(T.total)],
      ['RUNNING MTR', f2(T.run)],
      ['WASTAGE RATE', pct(T.waste, T.total)],
    ] as const
  ).forEach(([k, v], i) => {
    const x = M + i * (tw + 3),
      rate = i === 4;
    if (rate) {
      doc.setFillColor(...PURPLE);
      doc.roundedRect(x, y, tw, 20, 1.5, 1.5, 'F');
    } else {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, y, tw, 20, 1.5, 1.5);
      doc.setFillColor(...BAND[i]);
      doc.rect(x + 3, y, tw - 6, 1.1, 'F');
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...((rate ? [238, 214, 229] : MUT) as RGB));
    doc.text(k, x + 3, y + 7);
    doc.setFont('courier', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...((rate ? [255, 255, 255] : INK) as RGB));
    doc.text(v, x + 3, y + 16);
  });
  y += 30;

  const after = {
    didDrawPage: (d: { pageNumber: number }) => {
      if (d.pageNumber > 1) runHead();
    },
    margin: { left: M, right: M, top: 24, bottom: 20 },
  };
  // Group rows (location or material name) and subtotal rows are marked on the row array.
  const grp = (t: string, span: number): BodyRow => Object.assign([{ content: t, colSpan: span, styles: { fontStyle: 'bold', fillColor: WARM, textColor: PURPLE } }] as Cell[], { _grp: 1 as const });
  const sub = (cells: Cell[]): BodyRow => Object.assign(cells, { _sub: 1 as const });
  const matRow = (cells: Cell[]): BodyRow => Object.assign(cells, { _mat: 1 as const });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const style = (from: number) => (d: any) => {
    if (d.column.index >= from) d.cell.styles.halign = 'right';
    if (d.section === 'body' && d.row.raw._sub) {
      d.cell.styles.fontStyle = 'bold';
      d.cell.styles.lineWidth = { bottom: 0.3 };
      d.cell.styles.lineColor = [201, 209, 206];
    }
    if (d.section === 'body' && d.row.raw._mat) {
      d.cell.styles.fontStyle = 'bold';
      d.cell.styles.textColor = ORANGE;
    }
  };
  const WARN: RGB = [180, 84, 10];

  heading('Summary by item');
  y += 1;
  const body1: BodyRow[] = [];
  C.locs.forEach((l) => {
    let n = 0;
    body1.push(grp(l.L.name || 'Unnamed location', 9));
    l.rows.forEach((x) => {
      if ('error' in x.r) body1.push([++n, x.it.name || '–', { content: x.r.error, colSpan: 7, styles: { textColor: WARN } }]);
    });
    l.groups.forEach((g) => {
      g.rows.forEach((x) => {
        const p = sqmPanelTxt(g, x.it.id);
        body1.push([++n, (x.it.name || '–') + (p ? '\n' + p : ''), `${x.it.w} × ${x.it.h} cm`, x.r.q, '', f2(x.r.real), '', '', '']);
      });
      body1.push(
        g.error
          ? matRow(['', { content: `${g.mat.name}: ${g.error}`, colSpan: 8, styles: { textColor: WARN } }])
          : matRow(['', { content: `${g.mat.name} · ${g.useTxt}`, colSpan: 2 }, g.pcs, g.mat.kind === 'roll' ? f2(g.run) : g.useTxt, f2(g.real), f2(g.waste), f2(g.total), pct(g.waste, g.total)]),
      );
    });
    body1.push(sub(['', { content: 'Subtotal ' + (l.L.name || ''), colSpan: 2 }, l.pcs, f2(l.run), f2(l.real), f2(l.waste), f2(l.total), pct(l.waste, l.total)]));
  });
  autoTable(doc, {
    ...tblStyle,
    ...after,
    startY: y,
    head: [['#', 'Item', 'Size', 'Qty', 'Running m / sheets', 'Real SQM', 'Wastage SQM', 'Total SQM', 'Waste %']],
    body: body1,
    foot: [['', { content: `Job total · ${T.items} item${T.items === 1 ? '' : 's'}`, colSpan: 2 }, T.pcs, f2(T.run), f2(T.real), f2(T.waste), f2(T.total), pct(T.waste, T.total)]],
    footStyles: { fontStyle: 'bold', textColor: PURPLE, lineWidth: { top: 0.5 }, lineColor: PURPLE },
    showFoot: 'lastPage',
    columnStyles: { 0: { cellWidth: 6 } },
    didParseCell: style(3),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastY = () => (doc as any).lastAutoTable.finalY as number;
  y = lastY() + 10;
  // Notes go on page 1 when they fit; otherwise under the stock list, so no page holds only notes.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const noteLines = doc.splitTextToSize(sqmNotes(job), PW - 2 * M) as string[],
    notesH = 10 + noteLines.length * 4;
  const drawNotes = () => {
    heading('Notes');
    y += 3;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(74, 85, 82);
    doc.text(noteLines, M, y);
    y += noteLines.length * 4;
  };
  const notesOnFirst = y + notesH < 276;
  if (notesOnFirst) drawNotes();

  // stock list on its own page
  doc.addPage();
  runHead();
  y = 28;
  heading('Material to pull from stock');
  y += 1;
  const body2: BodyRow[] = [];
  C.stockGroups.forEach((s) => {
    body2.push(grp(`${s.mat.name} · ${s.sizeTxt}`, 8));
    s.entries.forEach((e) =>
      body2.push([e.loc || '–', e.g.rows.map((x) => x.it.name || '–').join(', '), e.g.pcs, sqmUseShort(s.mat, e.g.use), f2(e.g.real), f2(e.g.waste), f2(e.g.total), pct(e.g.waste, e.g.total)]),
    );
    body2.push(sub([{ content: `Total ${s.mat.name} (${s.sizeTxt})`, colSpan: 2 }, s.pcs, s.useTxt, f2(s.real), f2(s.waste), f2(s.total), pct(s.waste, s.total)]));
  });
  autoTable(doc, {
    ...tblStyle,
    ...after,
    startY: y,
    head: [['Location', 'Items', 'Pcs', 'Running m / sheets', 'Real SQM', 'Wastage SQM', 'Total SQM', 'Waste %']],
    body: body2,
    didParseCell: style(2),
  });
  if (!notesOnFirst) {
    y = lastY() + 10;
    if (y + notesH > 276) {
      doc.addPage();
      runHead();
      y = 28;
    }
    drawNotes();
  }

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(M, 283, PW - M, 283);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PURPLE);
    doc.text(by, M, 288);
    const bw = doc.getTextWidth(by);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUT);
    doc.text(` · ${dateTxt}`, M + bw, 288);
    doc.setTextColor(...ORANGE);
    doc.text(`Page ${i} of ${n}`, PW - M, 288, { align: 'right' });
    band(PH - 3, 3);
  }
  // The job itself rides inside the PDF, so "Open PDF report" can put it back exactly.
  doc.setProperties({ title: 'SQM & Wastage Report', subject: 'SQMJOB1:' + btoa(unescape(encodeURIComponent(JSON.stringify(jobPayload(job))))) });
  return doc.output('blob');
}
