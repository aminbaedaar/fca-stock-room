// Helpers shared by the server functions (Deno, Supabase Edge Functions).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Count, Item, Member, Move, StockRequest } from './core/index.ts';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/** Full-rights client. Only used after the caller has been checked. */
export function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}

/** The signed-in member who made this request, or null. */
export async function caller(req: Request, db: SupabaseClient): Promise<Member | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data.user) return null;
  const { data: m } = await db.from('members').select('*').eq('user_id', data.user.id).maybeSingle();
  return (m as Member) ?? null;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

export async function loadItems(db: SupabaseClient, sinceDays = 400): Promise<Item[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const { data: items, error } = await db.from('items').select('*').eq('active', true).order('sort');
  if (error) throw error;
  const counts: (Count & { item_id: string })[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await db.from('counts').select('*').gte('date', since).order('date').range(from, from + 999);
    if (e) throw e;
    counts.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return (items ?? []).map((i) => ({
    ...i,
    qty: num(i.qty),
    min_level: num(i.min_level),
    counts: counts.filter((c) => c.item_id === i.id).map((c) => ({ date: c.date, qty: num(c.qty) })),
  }));
}

export async function loadMoves(db: SupabaseClient, sinceDays: number, limit = 1000): Promise<Move[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data, error } = await db.from('moves').select('*').gte('at', since).order('at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((m) => ({ ...m, delta: num(m.delta), balance: m.balance == null ? null : num(m.balance), metres: m.metres == null ? null : num(m.metres) }));
}

export async function loadPendingRequests(db: SupabaseClient): Promise<StockRequest[]> {
  const { data, error } = await db.from('requests').select('*').eq('status', 'pending');
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, qty: num(r.qty) }));
}
