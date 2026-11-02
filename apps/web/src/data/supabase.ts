import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Count, Item, Member, Move, Report, StockRequest } from '@fca/core';
import { ServerError, type Backend } from './backend';
import type { Op, Snapshot } from './types';

// Real backend: Supabase (database, login, live updates, server functions).

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const hasSupabase = !!(url && anonKey);

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!client) client = createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));
const ME_KEY = 'fca.me.v1';

/** Reads all rows of a query, 1000 at a time (the API's page size). */
async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max = 20000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await sb().rpc(fn, args);
  if (error) {
    // PostgREST errors carry a code; a missing code means the request never arrived.
    if ((error as { code?: string }).code) throw new ServerError(error.message);
    throw new Error(error.message);
  }
  return data;
}

function fixMove(m: Move): Move {
  return { ...m, delta: num(m.delta), balance: m.balance == null ? null : num(m.balance), metres: m.metres == null ? null : num(m.metres) };
}

export const supabaseBackend: Backend = {
  mode: 'supabase',

  async currentMember() {
    const { data } = await sb().auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const meta = user.user_metadata ?? {};
    const { data: m, error } = await sb().rpc('touch_member', { p_name: meta.full_name ?? meta.name ?? null, p_photo: meta.avatar_url ?? meta.picture ?? null });
    if (!error && m) {
      localStorage.setItem(ME_KEY, JSON.stringify(m));
      return m as Member;
    }
    // Offline: use the last known profile (role included) for this user.
    try {
      const cached = JSON.parse(localStorage.getItem(ME_KEY) ?? 'null') as Member | null;
      if (cached?.user_id === user.id) return cached;
    } catch {
      /* ignore */
    }
    return { user_id: user.id, name: meta.full_name ?? user.email ?? '', email: user.email ?? '', photo: '', role: 'viewer', last_seen: null };
  },
  onAuthChange(cb) {
    const { data } = sb().auth.onAuthStateChange((event) => {
      if (event !== 'TOKEN_REFRESHED') cb();
    });
    return () => data.subscription.unsubscribe();
  },
  async signIn(email, password) {
    const { error } = await sb().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  },
  async signUp(email, password, name) {
    const { data, error } = await sb().auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: location.origin } });
    if (error) throw new Error(error.message);
    return data.session ? 'signed-in' : 'check-email';
  },
  async signInWithGoogle() {
    const { error } = await sb().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } });
    if (error) throw new Error(error.message);
  },
  async sendPasswordReset(email) {
    const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/?reset=1` });
    if (error) throw new Error(error.message);
  },
  async updatePassword(password) {
    const { error } = await sb().auth.updateUser({ password });
    if (error) throw new Error(error.message);
  },
  async signOut() {
    await sb().auth.signOut();
  },

  async load() {
    const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const [items, counts, moves, requests, reports, members] = await Promise.all([
      all<Item>((a, b) => sb().from('items').select('*').order('sort').range(a, b)),
      all<Count & { item_id: string }>((a, b) => sb().from('counts').select('*').gte('date', since).order('date').range(a, b)),
      all<Move>((a, b) => sb().from('moves').select('*').order('at', { ascending: false }).range(a, b), 5000),
      all<StockRequest>((a, b) => sb().from('requests').select('*').order('created_at', { ascending: false }).range(a, b), 2000),
      all<Report>((a, b) => sb().from('reports').select('*').order('id', { ascending: false }).range(a, b), 52),
      all<Member>((a, b) => sb().from('members').select('*').order('name').range(a, b)),
    ]);
    const byItem = new Map<string, Count[]>();
    for (const c of counts) {
      const list = byItem.get(c.item_id) ?? [];
      list.push({ date: c.date, qty: num(c.qty) });
      byItem.set(c.item_id, list);
    }
    return {
      items: items.map((i) => ({ ...i, qty: num(i.qty), min_level: num(i.min_level), counts: byItem.get(i.id) ?? [] })),
      moves: moves.map(fixMove),
      requests: requests.map((r) => ({ ...r, qty: num(r.qty) })),
      reports,
      members,
    } satisfies Snapshot;
  },

  subscribe(onChange) {
    const channel = sb()
      .channel('fca-all')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => onChange())
      .subscribe();
    return () => {
      sb().removeChannel(channel);
    };
  },

  async run(op: Op) {
    switch (op.kind) {
      case 'move':
        return rpc('record_move', { p_id: op.id, p_item: op.item_id, p_type: op.type, p_qty: op.qty, p_metres: op.metres, p_client: op.client, p_job: op.job, p_note: op.note, p_at: op.at });
      case 'stocktake':
        return rpc('save_stock_take', { p_id: op.id, p_date: op.date, p_counts: op.counts });
      case 'saveItem':
        return rpc('upsert_item', {
          p_id: op.id, p_item_id: op.item_id, p_name: op.fields.name, p_size: op.fields.size, p_category: op.fields.category,
          p_unit: op.fields.unit, p_min: op.fields.min_level, p_note: op.fields.note, p_qty: op.qty, p_sort: null,
        });
      case 'removeItem':
        return rpc('remove_item', { p_id: op.id, p_item: op.item_id, p_reason: op.reason });
      case 'void':
        return rpc('void_move', { p_id: op.id, p_move: op.move_id });
      case 'request':
        return rpc('create_request', { p_id: op.id, p_item: op.item_id, p_qty: op.qty, p_client: op.client, p_job: op.job, p_note: op.note });
      case 'decide':
        return rpc('decide_request', { p_id: op.id, p_request: op.request_id, p_approve: op.approve });
      case 'setRole':
        return rpc('set_role', { p_user: op.user_id, p_role: op.role });
      case 'import':
        return rpc('import_items', { p_items: op.rows });
    }
  },

  async ai(messages) {
    const { data, error } = await sb().functions.invoke('ai-assistant', { body: { messages } });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      let msg = error.message;
      try {
        msg = (await ctx?.json())?.error ?? msg;
      } catch {
        /* keep message */
      }
      throw new ServerError(msg);
    }
    return data;
  },

  async writeSummary() {
    const { error } = await sb().functions.invoke('monday-summary', { body: { source: 'manual' } });
    if (error) throw new ServerError(error.message);
  },

  async savePushSubscription(sub) {
    const json = sub.toJSON();
    const { data } = await sb().auth.getUser();
    const { error } = await sb().from('push_subscriptions').upsert({
      endpoint: json.endpoint,
      user_id: data.user?.id,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
    });
    if (error) throw new Error(error.message);
  },
};
