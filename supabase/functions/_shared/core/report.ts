import type { Item, Move, StockRequest } from './types.ts';
import { itemStats, fmtCover, ORDER_WEEKS } from './calc.ts';
import { itemLabel } from './search.ts';
import { fmtQty } from './units.ts';
import { addDays, fmtDate, kigaliDay } from './dates.ts';

const MAX_ROWS = 8;
const MAX_NAMES = 6;

function nameList(items: Item[]): string {
  const names = items.slice(0, MAX_NAMES).map(itemLabel);
  const more = items.length - names.length;
  return names.join(', ') + (more > 0 ? ` and ${more} more` : '');
}

/**
 * The Monday summary, as short markdown (kept under ~250 words).
 * Deterministic: the same data always gives the same report.
 */
export function buildMondayReport(input: {
  items: Item[];
  moves: Move[];
  requests: StockRequest[];
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const today = kigaliDay(now);
  const weekAgo = addDays(today, -7);
  const items = input.items.filter((i) => i.active);
  const rows = items.map((item) => ({ item, s: itemStats(item) }));

  const out: string[] = [`## Monday stock summary · ${fmtDate(today)}`, ''];

  // Order now
  const zeroUsed = rows.filter((r) => r.item.qty <= 0 && r.s.weeklyUse > 0).sort((a, b) => b.s.weeklyUse - a.s.weeklyUse);
  const zeroIdle = rows.filter((r) => r.item.qty <= 0 && r.s.weeklyUse <= 0);
  out.push('### Order now');
  if (zeroUsed.length) {
    out.push('| Item | Left | Use/wk | Order |', '|---|---|---|---|');
    for (const r of zeroUsed.slice(0, MAX_ROWS))
      out.push(`| ${itemLabel(r.item)} | 0 | ${fmtQty(Math.round(r.s.weeklyUse * 10) / 10)} | ${r.s.suggestedOrder} ${r.item.unit} |`);
    if (zeroUsed.length > MAX_ROWS) out.push(`| +${zeroUsed.length - MAX_ROWS} more | | | |`);
  } else {
    out.push('Nothing used recently has run out.');
  }
  if (zeroIdle.length) out.push('', `At 0 with no recent use: ${nameList(zeroIdle.map((r) => r.item))}.`);
  out.push('');

  // Running low
  const lowUsed = rows.filter((r) => r.s.status === 'low' && r.s.weeklyUse > 0).sort((a, b) => a.s.cover - b.s.cover);
  const lowIdle = rows.filter((r) => r.s.status === 'low' && r.s.weeklyUse <= 0);
  out.push('### Running low');
  if (lowUsed.length) {
    out.push('| Item | Left | Cover | Order |', '|---|---|---|---|');
    for (const r of lowUsed.slice(0, MAX_ROWS))
      out.push(`| ${itemLabel(r.item)} | ${fmtQty(r.item.qty)} ${r.item.unit} | ${fmtCover(r.s.cover)} | ${r.s.suggestedOrder || '–'} |`);
    if (lowUsed.length > MAX_ROWS) out.push(`| +${lowUsed.length - MAX_ROWS} more | | | |`);
  } else {
    out.push('Nothing in use is running low.');
  }
  if (lowIdle.length) out.push('', `Under minimum, no recent use: ${nameList(lowIdle.map((r) => r.item))}.`);
  out.push('', `_Order rule: enough for ${ORDER_WEEKS} weeks of use (or the minimum, if higher), minus what is left._`, '');

  // Notes
  out.push('### Notes');
  const recentOuts = input.moves.filter((m) => m.type === 'out' && !m.voided && kigaliDay(m.at) > weekAgo);
  if (recentOuts.length) {
    const biggest = [...recentOuts].sort((a, b) => a.delta - b.delta).slice(0, 3);
    out.push(`- Biggest stock outs: ${biggest.map((m) => `${m.item_name} ${fmtQty(-m.delta)} ${m.unit}${m.client ? ` (${m.client})` : ''}`).join('; ')}.`);
    const byClient = new Map<string, number>();
    for (const m of recentOuts) if (m.client) byClient.set(m.client, (byClient.get(m.client) ?? 0) + 1);
    const top = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (top.length) out.push(`- Top clients: ${top.map(([c, n]) => `${c} (${n} ${n === 1 ? 'job' : 'jobs'})`).join(', ')}.`);
  } else {
    out.push('- No movements logged in the last 7 days. Please log every stock out so the numbers stay right.');
  }
  const pending = input.requests.filter((r) => r.status === 'pending').length;
  out.push(pending ? `- ${pending} pending ${pending === 1 ? 'request' : 'requests'} waiting for approval.` : '- No pending requests.');

  const lastCount = items.reduce((max, i) => {
    const d = i.counts.reduce((m, c) => (c.date > m ? c.date : m), '');
    return d > max ? d : max;
  }, '');
  if (lastCount && lastCount >= addDays(today, -8)) out.push(`- Stock take recorded on ${fmtDate(lastCount)}.`);
  else out.push(`- No stock take in the last 8 days${lastCount ? ` (last: ${fmtDate(lastCount)})` : ''}. Managers: please do this week's count.`);

  return out.join('\n');
}
