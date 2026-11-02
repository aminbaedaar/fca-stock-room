/**
 * Parse a roll size such as "1.27X50M" (1.27 m wide, 50 m long).
 * Returns null when the size does not describe a roll.
 */
export function parseRollSize(size: string): { width: number; length: number } | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*M\s*$/i.exec(size ?? '');
  if (!m) return null;
  const width = Number(m[1]);
  const length = Number(m[2]);
  // "2X2" style sizes (tents) are not rolls: a roll is long and narrow.
  if (!(length >= 10 && width > 0 && width < 10)) return null;
  return { width, length };
}

/** Roll length in metres, or null if the item is not measured in rolls. */
export function rollLength(unit: string, size: string): number | null {
  if (unit !== 'Rolls') return null;
  return parseRollSize(size)?.length ?? null;
}

export function metresToRolls(metres: number, length: number): number {
  return round(metres / length, 4);
}

export function rollsToMetres(rolls: number, length: number): number {
  return round(rolls * length, 2);
}

export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Display a quantity without trailing zeros: 12, 0.5, 2.25 */
export function fmtQty(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '–';
  return String(round(n, 3));
}
