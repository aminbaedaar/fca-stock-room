// Weekly PDF of complimentary and no-sales-order jobs, for the Boss to check
// whether each job has been invoiced. Same First Choice look as the SQM report.

import { SPECIAL_KINDS, SPECIAL_STAGES, sqmDate, type SpecialJob } from '@fca/core';

type RGB = [number, number, number];
const INK: RGB = [27, 35, 33],
  MUT: RGB = [107, 119, 116],
  ORANGE: RGB = [213, 80, 43],
  PURPLE: RGB = [89, 37, 84],
  WARM: RGB = [251, 242, 237],
  GREEN: RGB = [30, 128, 72],
  RED: RGB = [190, 40, 40],
  BAND: RGB[] = [
    [236, 178, 46],
    [227, 134, 46],
    [213, 80, 43],
    [189, 34, 82],
    [105, 40, 97],
    [89, 37, 84],
  ];

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

const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const fmtCm = (n: number) => String(Math.round(n * 10) / 10);
export const sizesText = (j: SpecialJob) =>
  j.lines.map((l) => `${l.material ? `${l.material}: ` : ''}${fmtCm(l.width_cm)} x ${fmtCm(l.height_cm)} cm x ${l.qty}`).join('\n');

/** Monday (YYYY-MM-DD) of the week that holds this day. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function specialPdfName(monday: string) {
  return `Complimentary-NoSO-Jobs-week-${monday}.pdf`;
}

async function loadPhoto(url: string): Promise<Logo | null> {
  const l = await loadLogo(url, 1);
  return l.src ? l : null;
}

export async function buildSpecialPdf(jobs: SpecialJob[], monday: string, madeBy: string, photoUrl?: (path: string) => Promise<string>): Promise<Blob> {
  const [{ jsPDF }, autoTableMod, MARK, WORD] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogo('/sqm-mark.png', 449 / 425),
    loadLogo('/sqm-wordmark.png', 1033 / 270),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const PW = 297,
    PH = 210,
    M = 12;
  const sunday = addDaysIso(monday, 6);
  const list = [...jobs].sort((a, b) => (a.job_date < b.job_date ? -1 : a.job_date > b.job_date ? 1 : a.created_at < b.created_at ? -1 : 1));

  const band = (y: number, h: number, x0 = 0, x1 = PW) => {
    const w = (x1 - x0) / BAND.length;
    BAND.forEach((c, i) => {
      doc.setFillColor(...c);
      doc.rect(x0 + i * w, y, w + 0.05, h, 'F');
    });
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

  // header
  band(0, 3);
  const mw = img(MARK, M, 8, 15);
  img(WORD, M + mw + 3, 11, 9);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...PURPLE);
  doc.text('Complimentary & No Sales Order Jobs', PW - M, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...ORANGE);
  doc.text(`Week ${sqmDate(monday)} to ${sqmDate(sunday)}`, PW - M, 21, { align: 'right' });
  band(27, 0.7, M, PW - M);

  // summary tiles
  const approved = list.filter((j) => j.status === 'approved');
  const tiles: [string, string, RGB][] = [
    ['Jobs this week', String(list.length), PURPLE],
    ['Approved', String(approved.length), PURPLE],
    ['Waiting / rejected', `${list.filter((j) => j.status === 'pending').length} / ${list.filter((j) => j.status === 'rejected').length}`, MUT],
    ['Invoiced', String(approved.filter((j) => j.invoiced).length), GREEN],
    ['NOT invoiced', String(approved.filter((j) => !j.invoiced).length), RED],
    ['Total SQM', f2(list.reduce((t, j) => t + j.sqm, 0)), PURPLE],
  ];
  const tw = (PW - 2 * M - 5 * 3) / 6;
  tiles.forEach(([label, value, colour], i) => {
    const x = M + i * (tw + 3);
    doc.setFillColor(...WARM);
    doc.roundedRect(x, 31, tw, 15, 1.5, 1.5, 'F');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUT);
    doc.text(label.toUpperCase(), x + 3, 36);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...colour);
    doc.text(value, x + 3, 43);
    doc.setFont('helvetica', 'normal');
  });

  const statusTxt = (j: SpecialJob) =>
    j.status === 'approved' ? `Approved\n${j.decided_by_name}` : j.status === 'rejected' ? `Rejected\n${j.decided_by_name}${j.decide_note ? `: ${j.decide_note}` : ''}` : 'Waiting for approval';
  const invTxt = (j: SpecialJob) => (j.status !== 'approved' ? '–' : j.invoiced ? `YES${j.invoice_no ? `\n${j.invoice_no}` : ''}` : 'NO');

  autoTable(doc, {
    startY: 50,
    margin: { left: M, right: M, bottom: 16 },
    theme: 'plain',
    head: [['#', 'Date', 'Client / job', 'Type', 'Sizes', 'SQM', 'Reason', 'Job status', 'Made by', 'Approval', 'Invoiced', 'Boss check']],
    body: list.length
      ? list.map((j, i) => [
          String(i + 1),
          sqmDate(j.job_date),
          j.job ? `${j.client}\n${j.job}` : j.client,
          SPECIAL_KINDS[j.kind],
          sizesText(j),
          f2(j.sqm),
          j.photos?.length ? `${j.reason}\n(${j.photos.length} screenshot${j.photos.length > 1 ? 's' : ''}: see end)` : j.reason,
          SPECIAL_STAGES[j.stage],
          j.created_by_name,
          statusTxt(j),
          invTxt(j),
          '',
        ])
      : [[{ content: 'No complimentary or no-sales-order jobs this week.', colSpan: 12, styles: { textColor: MUT, halign: 'center' } }]],
    styles: { font: 'helvetica', fontSize: 7.6, textColor: INK, cellPadding: { top: 1.6, bottom: 1.6, left: 1.4, right: 1.4 }, lineColor: [232, 226, 229], valign: 'top' },
    headStyles: { fontStyle: 'bold', textColor: PURPLE, lineWidth: { bottom: 0.5 }, lineColor: PURPLE },
    bodyStyles: { lineWidth: { bottom: 0.15 } },
    columnStyles: {
      0: { cellWidth: 7, textColor: MUT },
      1: { cellWidth: 21 },
      2: { cellWidth: 38, fontStyle: 'bold' },
      3: { cellWidth: 24 },
      4: { cellWidth: 39 },
      5: { cellWidth: 12, halign: 'right' },
      6: { cellWidth: 33 },
      7: { cellWidth: 17 },
      8: { cellWidth: 20 },
      9: { cellWidth: 23 },
      10: { cellWidth: 24, fontStyle: 'bold', fontSize: 6.8 },
      11: { cellWidth: 15 },
    },
    didParseCell: (d) => {
      if (d.section !== 'body' || !list.length) return;
      const j = list[d.row.index];
      if (d.column.index === 10 && j.status === 'approved') d.cell.styles.textColor = j.invoiced ? GREEN : RED;
      if (j.status === 'approved' && !j.invoiced) d.cell.styles.fillColor = [253, 236, 234];
      if (j.status !== 'approved') d.cell.styles.textColor = d.column.index === 10 ? MUT : d.cell.styles.textColor;
    },
    didDrawCell: (d) => {
      // an empty tick box for the Boss to tick by pen
      if (d.section === 'body' && d.column.index === 11 && list.length) {
        doc.setDrawColor(...MUT);
        doc.setLineWidth(0.25);
        doc.rect(d.cell.x + 2, d.cell.y + 1.6, 3.6, 3.6);
      }
    },
  });

  // sign-off
  const endY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  let y = endY + 12;
  if (y > PH - 24) {
    doc.addPage();
    y = 24;
  }
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.setDrawColor(...MUT);
  doc.setLineWidth(0.3);
  doc.text('Checked by (Boss):', M, y);
  doc.line(M + 32, y + 0.8, M + 110, y + 0.8);
  doc.text('Signature:', M + 120, y);
  doc.line(M + 140, y + 0.8, M + 200, y + 0.8);
  doc.text('Date:', M + 210, y);
  doc.line(M + 220, y + 0.8, PW - M, y + 0.8);

  // screenshots: one section per job, at the end
  const withPhotos = list.map((j, i) => ({ j, n: i + 1 })).filter(({ j }) => j.photos?.length);
  if (photoUrl && withPhotos.length) {
    doc.addPage();
    let py = 16;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...PURPLE);
    doc.text('Screenshots of the job details', M, py);
    py += 8;
    const boxH = 70,
      gap = 4;
    for (const { j, n } of withPhotos) {
      const pics = (await Promise.all(j.photos.map((p) => photoUrl(p).then(loadPhoto, () => null)))).filter((x): x is Logo => !!x);
      if (py + 8 + boxH > PH - 16) {
        doc.addPage();
        py = 16;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      doc.text(`#${n}  ${j.client}${j.job ? ` · ${j.job}` : ''}  ·  ${sqmDate(j.job_date)}`, M, py);
      doc.setFont('helvetica', 'normal');
      py += 3;
      let px = M;
      if (!pics.length) {
        doc.setFontSize(8);
        doc.setTextColor(...MUT);
        doc.text('Screenshots could not be loaded.', M, py + 5);
        py += 12;
        continue;
      }
      for (const pic of pics) {
        let h = boxH,
          w = h * pic.r;
        if (w > 120) {
          w = 120;
          h = w / pic.r;
        }
        if (px + w > PW - M) {
          px = M;
          py += boxH + gap;
          if (py + boxH > PH - 16) {
            doc.addPage();
            py = 16;
          }
        }
        try {
          doc.addImage(pic.src, 'JPEG', px, py, w, h);
          doc.setDrawColor(221, 214, 218);
          doc.rect(px, py, w, h);
        } catch {
          /* skip a picture that cannot be drawn */
        }
        px += w + gap;
      }
      py += boxH + 10;
    }
  }

  // footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(...MUT);
    doc.text(`First Choice Africa Ltd · made by ${madeBy} on ${sqmDate(new Date().toISOString().slice(0, 10))}`, M, PH - 7);
    doc.text(`Page ${p} of ${pages}`, PW - M, PH - 7, { align: 'right' });
    band(PH - 3, 3);
  }
  return doc.output('blob');
}
