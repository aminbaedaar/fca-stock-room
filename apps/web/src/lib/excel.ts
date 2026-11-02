import * as XLSX from 'xlsx';
import { todayStamp } from '@fca/core';
import { saveFile } from './save';

/** Saves rows as an .xlsx file named "<base> <today>.xlsx". */
export async function exportRows(base: string, sheets: { name: string; rows: Record<string, unknown>[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows);
    const keys = Object.keys(s.rows[0] ?? {});
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(40, Math.max(k.length, ...s.rows.slice(0, 200).map((r) => String(r[k] ?? '').length)) + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  await saveFile(`${base} ${todayStamp()}.xlsx`, new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

export async function readWorkbook(file: File) {
  const wb = XLSX.read(await file.arrayBuffer());
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[name], { header: 1, raw: true, defval: null }),
  }));
}
