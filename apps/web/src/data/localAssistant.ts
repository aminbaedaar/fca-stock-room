import { can, fmtCover, fmtQty, itemLabel, itemStats, needsAttention, rollLength, type Item, type Member } from '@fca/core';
import type { AiMessage, AiProposal, AiReply, Snapshot } from './types';

// The free built-in assistant (default; the optional Claude assistant runs on
// the server). It understands common stock questions and
// "used 3 rolls glossy 1.27 for MTN job" style instructions.

const STOP = new Set(['how', 'many', 'much', 'do', 'we', 'have', 'of', 'the', 'is', 'are', 'left', 'in', 'stock', 'for', 'a', 'an', 'used', 'use', 'took', 'take', 'out', 'received', 'got', 'add', 'added', 'rolls', 'roll', 'sheets', 'pcs', 'pieces', 'boxes', 'litres', 'metres', 'meters', 'm', 'job', 'client', 'please', 'what', 'about']);

function bestItem(items: Item[], text: string): Item | null {
  const words = text.toLowerCase().replace(/[×]/g, 'x').split(/[^a-z0-9.\-]+/).filter((w) => w && !STOP.has(w));
  let best: Item | null = null;
  let bestScore = 0;
  for (const i of items) {
    const hay = `${i.name} ${i.size}`.toLowerCase();
    const score = words.reduce((n, w) => n + (hay.includes(w) ? (/\d/.test(w) ? 2 : 1) : 0), 0);
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  return bestScore >= 2 ? best : null;
}

function lastUserText(messages: AiMessage[]): string {
  const m = messages[messages.length - 1];
  if (typeof m?.content === 'string') return m.content;
  const parts = (m?.content as { type: string; text?: string }[]) ?? [];
  return parts.filter((p) => p.type === 'text').map((p) => p.text).join(' ');
}

export async function localAssistant(messages: AiMessage[], snapshot: Snapshot, me: Member): Promise<AiReply> {
  const text = lastUserText(messages);
  const items = snapshot.items.filter((i) => i.active);
  const reply = (t: string, proposals: AiProposal[] = []): AiReply => ({
    text: t,
    proposals,
    assistant_content: [{ type: 'text', text: t }],
  });

  const action = /\b(used|use|took|take|out|cut|received|got|delivered|add(ed)?|in)\b/i.exec(text);
  const qtyMatch = /(\d+(?:\.\d+)?)\s*(m|metres?|meters?|rolls?|sheets?|pcs|pieces?|boxes?|bags?|l|litres?)?\b/i.exec(text);
  const isQuestion = /\?|^(how|what|which|when|do|are|is)\b/i.test(text.trim());

  if (action && qtyMatch && !isQuestion) {
    const item = bestItem(items, text);
    if (!item) return reply("I couldn't tell which item you mean. Please include the name and size, e.g. \"glossy 1.27\".");
    if (!can(me.role, 'stock')) return reply('Your role can view stock but cannot record stock in or out.');
    const type = /received|got|delivered|add|\bin\b/i.test(action[0]) ? 'in' : 'out';
    const unitWord = (qtyMatch[2] ?? '').toLowerCase();
    let qty = Number(qtyMatch[1]);
    let metres: number | null = null;
    const len = rollLength(item.unit, item.size);
    if (/^(m|metres?|meters?)$/.test(unitWord) && len) {
      metres = qty;
      qty = Math.round((qty / len) * 10000) / 10000;
    }
    const client = /\bfor\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*)/.exec(text)?.[1] ?? '';
    const job = /\bjob\s*[:#]?\s*([\w-]+)/i.exec(text)?.[1] ?? (/(\w+)\s+job\b/i.exec(text)?.[1] ?? '');
    const proposal: AiProposal = { tool_use_id: `local-${Date.now()}`, item_id: item.id, type, qty, metres, client, job: job === client ? '' : job, note: '' };
    return reply(`Here is what I understood. Please check and confirm:`, [proposal]);
  }

  if (/order|buy|purchase/i.test(text)) {
    const list = needsAttention(items).filter((x) => x.stats.suggestedOrder > 0).slice(0, 10);
    if (!list.length) return reply('Nothing needs ordering right now based on recent use.');
    return reply(
      'Suggested orders (enough for 6 weeks of use):\n' +
        list.map(({ item, stats }) => `- **${itemLabel(item)}**: order ${stats.suggestedOrder} ${item.unit} (left ${fmtQty(item.qty)}, ${fmtCover(stats.cover)} cover)`).join('\n'),
    );
  }

  if (/low|out of stock|running out|attention/i.test(text)) {
    const list = needsAttention(items).slice(0, 12);
    if (!list.length) return reply('Everything is above minimum with more than 3 weeks of cover.');
    return reply('Items needing attention:\n' + list.map(({ item, stats }) => `- **${itemLabel(item)}**: ${fmtQty(item.qty)} ${item.unit} (${stats.status === 'out' ? 'out' : fmtCover(stats.cover) + ' cover'})`).join('\n'));
  }

  const item = bestItem(items, text);
  if (item) {
    const s = itemStats(item);
    const len = rollLength(item.unit, item.size);
    return reply(
      `**${itemLabel(item)}**: ${fmtQty(item.qty)} ${item.unit} in stock${len ? ` (${fmtQty(item.qty * len)} m)` : ''}. ` +
        (s.weeklyUse > 0 ? `Use is about ${fmtQty(Math.round(s.weeklyUse * 10) / 10)} per week, so ${fmtCover(s.cover)} of cover.` : 'No recent use recorded.'),
    );
  }

  return reply('I can answer questions like "How many glossy 1.27 rolls do we have?", "What should I order this week?" or "What is running low?", and record "used 3 rolls glossy 1.27 for MTN job" or "received 10 sheets foam board 5mm". Please include the item name and size.');
}
