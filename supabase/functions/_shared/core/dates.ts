// All dates are shown and grouped in Africa/Kigali time (UTC+2, no daylight saving).
export const TZ = 'Africa/Kigali';

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const isoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "2 Nov 2026" */
export function fmtDate(d: string | Date): string {
  return dayFmt.format(toDate(d));
}

/** "2 Nov 2026, 14:05" */
export function fmtDateTime(d: string | Date): string {
  const x = toDate(d);
  return `${dayFmt.format(x)}, ${timeFmt.format(x)}`;
}

/** Kigali calendar day as YYYY-MM-DD. */
export function kigaliDay(d: string | Date = new Date()): string {
  return isoFmt.format(toDate(d));
}

/** Whole days from a to b (YYYY-MM-DD strings). */
export function daysBetween(a: string, b: string): number {
  return (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000;
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
}

function toDate(d: string | Date): Date {
  if (d instanceof Date) return d;
  // A bare date means that calendar day in Kigali; noon avoids edge effects.
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00+02:00') : new Date(d);
}

/** File-name stamp, e.g. "2026-11-02". */
export const todayStamp = () => kigaliDay();
