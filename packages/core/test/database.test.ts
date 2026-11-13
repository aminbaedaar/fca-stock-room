// Runs the real Supabase migrations in an in-memory Postgres (PGlite) with a
// small stand-in for Supabase's auth schema, then checks permissions and the
// stock flows end to end.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const SHIM = `
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  create publication supabase_realtime;
`;

const migration = (f: string) =>
  readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8').replace(/create extension[^;]*;/g, '');

let db: PGlite;
const users: Record<string, string> = {};

async function signUp(name: string) {
  const id = randomUUID();
  users[name] = id;
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${name}@fca.rw`, { full_name: name }]);
  return id;
}

/** Run SQL as a signed-in user, through the same role the API uses. */
async function as<T = any>(name: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [users[name]]);
  await db.exec('set role authenticated');
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

const qtyOf = async (id: string) => Number((await db.query<{ qty: string }>('select qty from items where id = $1', [id])).rows[0].qty);

let glossy: string;
let mesh: string;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHIM);
  for (const f of ['0001_schema.sql', '0002_functions.sql', '0003_rls.sql', '0004_sqm.sql', '0005_calculator_role.sql', '0006_viewer_calculator_only.sql', '0007_team_and_reverse.sql']) await db.exec(migration(f));
  await db.exec('grant usage on schema public, auth to authenticated; grant select on all tables in schema public to authenticated;');
  for (const n of ['amin', 'stella', 'boss', 'mary', 'eric', 'carl']) await signUp(n);
  await db.query(`update members set role = 'staff' where user_id = $1`, [users.stella]);
  await db.query(`update members set role = 'boss' where user_id = $1`, [users.boss]);
  await db.query(`update members set role = 'manager' where user_id = $1`, [users.mary]);
  await db.query(`update members set role = 'viewer' where user_id = $1`, [users.eric]);

  glossy = (await as('mary', `select (upsert_item($1, null, 'Glossy sticker', '1.27x50m', 'Print Media', 'Rolls', 5, '', 10)).id`, [randomUUID()]))[0].id;
  mesh = (await as('mary', `select (upsert_item($1, null, 'Mesh banner', '3.2X50M', 'Flexi Banner', 'Rolls', 0, '', 2)).id`, [randomUUID()]))[0].id;
}, 60_000);

describe('sign up and roles', () => {
  it('first user is Admin, later users start as Staff', async () => {
    const rows = (await db.query<{ name: string; role: string }>('select name, role from members order by created_at')).rows;
    expect(rows[0]).toMatchObject({ name: 'amin', role: 'admin' });
    const fresh = await signUp('newbie');
    expect((await db.query<{ role: string }>('select role from members where user_id = $1', [fresh])).rows[0].role).toBe('staff');
  });

  it('only Admin can change roles, and the last Admin cannot be demoted', async () => {
    await expect(as('mary', `select set_role($1, 'admin')`, [users.mary])).rejects.toThrow(/not allowed/);
    await expect(as('amin', `select set_role($1, 'staff')`, [users.amin])).rejects.toThrow(/at least one Admin/);
  });
});

describe('row-level security', () => {
  it('signed-in users can read but not write tables directly', async () => {
    expect((await as('eric', 'select count(*)::int as n from items'))[0].n).toBe(0); // viewers: calculator only
    await expect(as('amin', `update items set qty = 999`)).rejects.toThrow(/permission denied/);
    await expect(as('amin', `delete from moves`)).rejects.toThrow(/permission denied/);
    await expect(as('amin', `insert into moves (id, type) values (gen_random_uuid(), 'in')`)).rejects.toThrow(/permission denied/);
  });

  it('the internal move function cannot be called from the API', async () => {
    await expect(
      as('amin', `select fca_apply_move(gen_random_uuid(), $1, 'in', 5, null, '', '', '', null)`, [glossy]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('stock in / out', () => {
  it('Staff can stock in and out; movement records who and the balance', async () => {
    await as('stella', `select record_move($1, $2, 'in', 4, null, '', '', 'Delivery')`, [randomUUID(), glossy]);
    const [m] = await as('stella', `select * from record_move($1, $2, 'out', 3, 150, 'MTN', 'Billboard')`, [randomUUID(), glossy]);
    expect(Number(m.delta)).toBe(-3);
    expect(Number(m.balance)).toBe(11);
    expect(Number(m.metres)).toBe(150);
    expect(m.user_name).toBe('stella');
    expect(m.item_name).toBe('GLOSSY STICKER 1.27X50M');
    expect(await qtyOf(glossy)).toBe(11);
  });

  it('a change sent twice (offline retry) is saved once', async () => {
    const id = randomUUID();
    await as('stella', `select record_move($1, $2, 'out', 1)`, [id, glossy]);
    await as('stella', `select record_move($1, $2, 'out', 1)`, [id, glossy]);
    expect(await qtyOf(glossy)).toBe(10);
    expect((await db.query<{ n: number }>('select count(*)::int as n from moves where id = $1', [id])).rows[0].n).toBe(1);
  });

  it('cannot take out more than is in stock', async () => {
    await expect(as('stella', `select record_move($1, $2, 'out', 3)`, [randomUUID(), mesh])).rejects.toThrow(/Not enough stock/);
  });

  it('Staff cannot adjust, edit items or remove items; Viewers cannot stock out', async () => {
    await expect(as('stella', `select record_move($1, $2, 'adjust', -1, null, '', '', 'damaged')`, [randomUUID(), glossy])).rejects.toThrow(/not allowed/);
    await expect(as('stella', `select upsert_item($1, null, 'X', '', 'Print Media', 'Rolls', 0, '')`, [randomUUID()])).rejects.toThrow(/not allowed/);
    await expect(as('stella', `select remove_item($1, $2)`, [randomUUID(), mesh])).rejects.toThrow(/not allowed/);
    await expect(as('eric', `select record_move($1, $2, 'out', 1)`, [randomUUID(), glossy])).rejects.toThrow(/not allowed/);
  });

  it('Boss can do what a Manager can', async () => {
    await as('boss', `select record_move($1, $2, 'adjust', 0.5, null, '', '', 'Found half roll')`, [randomUUID(), glossy]);
    expect(await qtyOf(glossy)).toBe(10.5);
  });
});

describe('void', () => {
  it('Managers can reverse with a reason; Staff cannot; stock is reversed and the original kept', async () => {
    const id = randomUUID();
    await as('stella', `select record_move($1, $2, 'out', 2, null, 'Bank', 'Banner')`, [id, glossy]);
    expect(await qtyOf(glossy)).toBe(8.5);
    await expect(as('stella', `select void_move($1, $2, 'typo')`, [randomUUID(), id])).rejects.toThrow(/not allowed/);
    await expect(as('mary', `select void_move($1, $2, '  ')`, [randomUUID(), id])).rejects.toThrow(/reason/);
    const rid = randomUUID();
    await as('mary', `select void_move($1, $2, 'Wrong item chosen')`, [rid, id]);
    expect(await qtyOf(glossy)).toBe(10.5);
    const orig = (await db.query<any>('select voided, voided_by from moves where id = $1', [id])).rows[0];
    expect(orig.voided).toBe(true);
    expect(orig.voided_by).toBe(users.mary);
    const rev = (await db.query<any>('select note, user_name from moves where id = $1', [rid])).rows[0];
    expect(rev.note).toMatch(/Reason: Wrong item chosen$/);
    await expect(as('amin', `select void_move($1, $2, 'again')`, [randomUUID(), id])).rejects.toThrow(/already reversed/);
  });
});

describe('requests', () => {
  it('Staff request, Manager approves, and the stock-out is created', async () => {
    const reqId = randomUUID();
    await as('stella', `select create_request($1, $2, 2, 'MTN', 'Shop front', 'urgent')`, [reqId, glossy]);
    await expect(as('stella', `select decide_request($1, $2, true)`, [randomUUID(), reqId])).rejects.toThrow(/not allowed/);
    const decision = randomUUID();
    const [r] = await as('mary', `select * from decide_request($1, $2, true)`, [decision, reqId]);
    expect(r.status).toBe('approved');
    expect(r.move_id).toBe(decision);
    expect(await qtyOf(glossy)).toBe(8.5);
    // Retried approval does nothing more.
    await as('mary', `select decide_request($1, $2, true)`, [decision, reqId]);
    expect(await qtyOf(glossy)).toBe(8.5);
  });

  it('rejecting leaves stock unchanged', async () => {
    const reqId = randomUUID();
    await as('stella', `select create_request($1, $2, 1)`, [reqId, mesh]);
    const [r] = await as('mary', `select * from decide_request($1, $2, false)`, [randomUUID(), reqId]);
    expect(r.status).toBe('rejected');
    expect(await qtyOf(mesh)).toBe(2);
  });
});

describe('weekly stock take', () => {
  it('records a count for every item and logs a count movement only for changes', async () => {
    const id = randomUUID();
    const counts = [
      { item_id: glossy, qty: 8 },
      { item_id: mesh, qty: 2 },
    ];
    await expect(as('stella', `select save_stock_take($1, '2026-11-02', $2)`, [id, JSON.stringify(counts)])).rejects.toThrow(/not allowed/);

    const [{ save_stock_take: changed }] = await as('mary', `select save_stock_take($1, '2026-11-02', $2)`, [id, JSON.stringify(counts)]);
    expect(changed).toBe(1);
    expect(await qtyOf(glossy)).toBe(8);
    const c = (await db.query<any>(`select item_id, qty from counts where date = '2026-11-02' order by qty`)).rows;
    expect(c.map((x) => Number(x.qty))).toEqual([2, 8]);
    const m = (await db.query<any>(`select * from moves where type = 'count'`)).rows;
    expect(m).toHaveLength(1);
    expect(Number(m[0].delta)).toBe(-0.5);
    expect(m[0].note).toBe('Stock take 2 Nov 2026');

    // Sent again (offline retry): no change.
    await as('stella', `select record_move($1, $2, 'out', 1)`, [randomUUID(), glossy]);
    await as('mary', `select save_stock_take($1, '2026-11-02', $2)`, [id, JSON.stringify(counts)]);
    expect(await qtyOf(glossy)).toBe(7);
  });
});

describe('items', () => {
  it('edits and removals are logged, never deleted', async () => {
    await as('mary', `select upsert_item($1, $2, 'Mesh banner', '3.2X50M', 'Flexi Banner', 'Rolls', 3, 'outdoor')`, [randomUUID(), mesh]);
    await as('mary', `select remove_item($1, $2, 'Not stocked any more')`, [randomUUID(), mesh]);
    const m = (await db.query<any>(`select type, note from moves where item_id = $1 order by at`, [mesh])).rows;
    expect(m.map((x) => x.type)).toEqual(['created', 'edit', 'removed']);
    expect(m[1].note).toContain('minimum 0 → 3');
    expect((await db.query<any>('select active from items where id = $1', [mesh])).rows[0].active).toBe(false);
  });

  it('Admin import adds new items with history and merges existing ones', async () => {
    const payload = [
      { name: 'Foam board', size: '5mm', category: 'Print Media', unit: 'Sheets', qty: 133, min_level: 0, note: '', counts: [{ date: '2026-10-19', qty: 152 }, { date: '2026-10-26', qty: 133 }] },
      { name: 'GLOSSY STICKER', size: '1.27X50M', category: 'Print Media', unit: 'Rolls', qty: 1, counts: [{ date: '2026-10-26', qty: 195 }] },
    ];
    await expect(as('mary', 'select import_items($1)', [JSON.stringify(payload)])).rejects.toThrow(/not allowed/);
    const [{ import_items: res }] = await as('amin', 'select import_items($1)', [JSON.stringify(payload)]);
    expect(res).toEqual({ added: 1, merged: 1 });
    expect(await qtyOf(glossy)).toBe(7); // existing qty untouched
  });
});

describe('job calculator materials', () => {
  it('everyone can read the starting list; only managers can save it', async () => {
    const rows = await as('eric', 'select id, name, widths from sqm_materials order by sort');
    expect(rows.length).toBe(27);
    expect(rows[0]).toMatchObject({ name: 'Glossy Sticker', widths: '152, 127, 107' });
    const list = JSON.stringify([{ id: 'm3', name: 'Glossy Sticker', kind: 'roll', widths: '127', width: 127, length: 0, bleed: 3, overlap: 2, links: { '127': glossy } }]);
    await expect(as('stella', 'select save_sqm_materials($1)', [list])).rejects.toThrow(/not allowed/);
    await expect(as('mary', `select save_sqm_materials('[]')`)).rejects.toThrow(/cannot be empty/);
    await as('mary', 'select save_sqm_materials($1)', [list]);
    const after = await as('eric', 'select id, widths, links from sqm_materials');
    expect(after).toEqual([{ id: 'm3', widths: '127', links: { '127': glossy } }]);
  });
});

describe('Viewer: job calculator only', () => {
  it('a Viewer sees only the calculator materials', async () => {
    await as('amin', `select set_role($1, 'viewer')`, [users.carl]);
    expect((await as('carl', 'select user_id from members')).length).toBe(1); // only their own row, not the team
    for (const t of ['items', 'counts', 'moves', 'requests', 'reports', 'stock_takes'])
      expect(await as('carl', `select * from ${t}`), t).toEqual([]);
    expect((await as('carl', 'select id from sqm_materials')).length).toBeGreaterThan(0);
    // touch_member still returns their own record, so the app knows their role
    const [me] = await as('carl', `select (touch_member('Carl', null)).role`);
    expect(me.role).toBe('viewer');
  });
  it('cannot change stock, ask for material or edit materials', async () => {
    await expect(as('carl', `select record_move($1, $2, 'out', 1, null, '', '', '', now())`, [randomUUID(), glossy])).rejects.toThrow(/not allowed/);
    await expect(as('carl', `select create_request($1, $2, 1, '', '', '')`, [randomUUID(), glossy])).rejects.toThrow(/not allowed/);
    await expect(as('carl', `select save_sqm_materials('[{"id":"x","name":"X","kind":"roll","widths":"100","width":100,"length":0,"bleed":0,"overlap":2}]')`)).rejects.toThrow(/not allowed/);
  });
});

describe('team list: Admin only', () => {
  it('the Admin sees everyone; others see only themselves', async () => {
    expect((await as('amin', 'select user_id from members')).length).toBeGreaterThan(3);
    for (const n of ['mary', 'boss', 'stella']) {
      const rows = await as<{ user_id: string }>(n, 'select user_id from members');
      expect(rows.map((r) => r.user_id), n).toEqual([users[n]]);
    }
  });
});
