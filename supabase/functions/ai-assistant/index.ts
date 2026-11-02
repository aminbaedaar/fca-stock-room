// AI stock assistant. Answers questions about stock and turns instructions
// like "used 3 rolls glossy 1.27 for MTN job" into a proposal card. It never
// saves anything itself: the app saves only after the user confirms, through
// the same permission-checked database function as the normal form.
import Anthropic from 'npm:@anthropic-ai/sdk';
import { admin, caller, cors, json, loadItems, loadMoves, loadPendingRequests } from '../_shared/server.ts';
import { can, fmtCover, fmtDate, itemLabel, itemStats, kigaliDay, rollLength, round, type Item } from '../_shared/core/index.ts';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
const PER_MINUTE = 10;
const PER_DAY = 200;
const MAX_MESSAGES = 40;
const MAX_TEXT = 2000;

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

const INSTRUCTIONS = `You are the stock assistant for FCA Stock Room, the stock system of First Choice Africa Limited, a print and branding company in Kigali, Rwanda.

Answer questions about stock in plain, short English that warehouse staff understand. Use the stock table you are given; never invent items or numbers. Quantities are in each item's unit. For rolls, the size "1.27X50M" means 1.27 m wide and 50 m long, so 0.5 roll = 25 m.

How the numbers are worked out (already calculated for you in the table):
- Use/week is the average drop between weekly counts (last 9 counts, ignoring obvious count corrections).
- Cover = stock ÷ use per week, in weeks.
- Status: OUT if stock is 0; LOW if at or under minimum or under 3 weeks of cover; otherwise OK.
- Suggested order = enough for 6 weeks of use (or the minimum if higher), minus stock, rounded up.

When the user says material was used, taken out, received or delivered, call the propose_movement tool so they can confirm it. Use "out" for used/taken and "in" for received/delivered. If they give metres for a roll item, fill metres and leave qty as metres ÷ roll length. Pick the item_id from the table; if more than one item could match, ask which one instead of guessing. Never say something was saved: the user confirms on a card. If the user cannot record movements, explain that their role can only view.

Keep answers brief. Use short markdown lists or small tables when listing several items. Dates are in Africa/Kigali time.`;

function stockTable(items: Item[]): string {
  const rows = items.map((i) => {
    const s = itemStats(i);
    const len = rollLength(i.unit, i.size);
    return [
      i.id,
      itemLabel(i),
      i.category,
      `${round(i.qty, 3)} ${i.unit}${len ? ` (${round(i.qty * len, 1)} m, ${len} m/roll)` : ''}`,
      round(i.min_level, 3),
      s.weeklyUse > 0 ? round(s.weeklyUse, 2) : 0,
      fmtCover(s.cover),
      s.status.toUpperCase(),
      s.suggestedOrder || '',
    ].join(' | ');
  });
  return ['item_id | item | category | stock | min | use/week | cover | status | order', ...rows].join('\n');
}

function validMessages(m: unknown): m is Anthropic.MessageParam[] {
  if (!Array.isArray(m) || m.length === 0 || m.length > MAX_MESSAGES) return false;
  return m.every((x, i) => {
    if (!x || typeof x !== 'object') return false;
    const role = (x as { role?: string }).role;
    if (role !== (i % 2 === 0 ? 'user' : 'assistant')) return false;
    const content = (x as { content?: unknown }).content;
    const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
    return role === 'assistant' || text.length <= MAX_TEXT + 2000;
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const db = admin();
  const me = await caller(req, db);
  if (!me || !can(me.role, 'view')) return json({ error: 'Please sign in.' }, 401);

  // Rate limit per person.
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [{ count: perMinute }, { count: perDay }] = await Promise.all([
    db.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', me.user_id).gte('at', minuteAgo),
    db.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', me.user_id).gte('at', dayAgo),
  ]);
  if ((perMinute ?? 0) >= PER_MINUTE) return json({ error: 'Too many questions in a minute. Please wait a moment.' }, 429);
  if ((perDay ?? 0) >= PER_DAY) return json({ error: 'Daily AI limit reached. Try again tomorrow.' }, 429);

  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request' }, 400);
  }
  if (!validMessages(body.messages)) return json({ error: 'Bad conversation format' }, 400);
  await db.from('ai_usage').insert({ user_id: me.user_id });

  const [items, moves, pending] = await Promise.all([loadItems(db), loadMoves(db, 30, 300), loadPendingRequests(db)]);
  const recent = moves
    .filter((m) => !m.voided && ['in', 'out', 'adjust', 'count'].includes(m.type))
    .slice(0, 80)
    .map((m) => `${fmtDate(m.at)} | ${m.type} | ${m.item_name} | ${m.delta} ${m.unit} | ${m.client} | ${m.job} | ${m.user_name}`)
    .join('\n');
  const canStock = can(me.role, 'stock');

  const context = [
    `Today: ${fmtDate(kigaliDay())}. You are talking to ${me.name || me.email} (role: ${me.role}; ${canStock ? 'can record stock in and out' : 'view only, cannot record movements'}).`,
    `Pending requests: ${pending.length}.`,
    `STOCK TABLE\n${stockTable(items)}`,
    `MOVEMENTS, LAST 30 DAYS (date | type | item | change | client | job | by)\n${recent || 'none'}`,
  ].join('\n\n');

  const tools: Anthropic.Tool[] = canStock
    ? [
        {
          name: 'propose_movement',
          description: 'Show the user a stock in / stock out card to confirm. Nothing is saved until they press confirm.',
          strict: true,
          input_schema: {
            type: 'object',
            additionalProperties: false,
            required: ['item_id', 'type', 'qty', 'metres', 'client', 'job', 'note'],
            properties: {
              item_id: { type: 'string', enum: items.map((i) => i.id) },
              type: { type: 'string', enum: ['in', 'out'] },
              qty: { type: 'number', description: "Quantity in the item's unit (for rolls: number of rolls, may be fractional)." },
              metres: { type: ['number', 'null'], description: 'Metres, only when the user gave metres for a roll item.' },
              client: { type: 'string' },
              job: { type: 'string' },
              note: { type: 'string' },
            },
          },
        } as Anthropic.Tool,
      ]
    : [];

  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: context },
      ],
      tools,
      messages: body.messages as Anthropic.MessageParam[],
    } as never);

    const res = response as unknown as Anthropic.Message;
    if ((res.stop_reason as string) === 'refusal') {
      return json({ text: "Sorry, I can't help with that. Please ask about stock.", proposals: [], assistant_content: [{ type: 'text', text: "Sorry, I can't help with that." }] });
    }

    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    const proposals = res.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'propose_movement')
      .map((b) => {
        const input = b.input as { item_id: string; type: 'in' | 'out'; qty: number; metres: number | null; client: string; job: string; note: string };
        const item = items.find((i) => i.id === input.item_id);
        if (!item || !['in', 'out'].includes(input.type)) return null;
        const len = rollLength(item.unit, item.size);
        const qty = input.metres && len ? round(input.metres / len, 4) : Number(input.qty);
        if (!(qty > 0)) return null;
        return {
          tool_use_id: b.id,
          item_id: item.id,
          type: input.type,
          qty,
          metres: input.metres && len ? input.metres : len ? round(qty * len, 2) : null,
          client: String(input.client ?? '').slice(0, 120),
          job: String(input.job ?? '').slice(0, 120),
          note: String(input.note ?? '').slice(0, 500),
        };
      })
      .filter(Boolean);

    return json({
      text: text || (proposals.length ? 'Please check and confirm:' : ''),
      proposals,
      assistant_content: res.content,
    });
  } catch (e) {
    console.error(e);
    const status = e instanceof Anthropic.RateLimitError ? 429 : 502;
    return json({ error: status === 429 ? 'The AI service is busy. Please try again in a minute.' : 'The AI service is not available right now.' }, status);
  }
});
