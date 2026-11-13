import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { can, PERMISSION_TABLE, type Permission } from '../src/roles.ts';
import { ROLES } from '../src/types.ts';

describe('permissions', () => {
  it('everyone except Viewers can see stock', () => {
    for (const r of ROLES) expect(can(r, 'view')).toBe(r !== 'viewer');
  });

  it('everyone can use the job calculator', () => {
    for (const r of ROLES) expect(can(r, 'calculator')).toBe(true);
  });

  it('Viewers can use the calculator and nothing else', () => {
    for (const p of Object.keys(PERMISSION_TABLE) as Permission[]) expect(can('viewer', p)).toBe(p === 'calculator');
  });

  it('staff can request and do stock in/out, but not edit items, approve or reverse', () => {
    expect(can('staff', 'request')).toBe(true);
    expect(can('staff', 'stock')).toBe(true);
    for (const p of ['adjust', 'items', 'approve', 'stocktake', 'summary', 'void', 'roles'] as Permission[])
      expect(can('staff', p)).toBe(false);
  });

  it('boss has the same rights as manager', () => {
    for (const p of Object.keys(PERMISSION_TABLE) as Permission[]) expect(can('boss', p)).toBe(can('manager', p));
  });

  it('managers and bosses can reverse movements', () => {
    for (const r of ROLES) expect(can(r, 'void')).toBe(['admin', 'boss', 'manager'].includes(r));
  });

  it('only admin can see the team, set roles, import and back up', () => {
    for (const p of ['roles', 'import', 'backup'] as Permission[])
      for (const r of ROLES) expect(can(r, p)).toBe(r === 'admin');
  });

  it('no role means no rights', () => {
    expect(can(null, 'view')).toBe(false);
  });

  it('the database function fca_can uses the same table', () => {
    // the newest migration that redefines fca_can
    const sql = readFileSync(new URL('../../../supabase/migrations/0007_team_and_reverse.sql', import.meta.url), 'utf8');
    const block = /-- PERMISSIONS START([\s\S]*?)-- PERMISSIONS END/.exec(sql)?.[1] ?? '';
    for (const [perm, roles] of Object.entries(PERMISSION_TABLE)) {
      const m = new RegExp(`when '${perm}' then array\\[([^\\]]*)\\]`).exec(block);
      expect(m, `fca_can is missing '${perm}'`).not.toBeNull();
      const sqlRoles = m![1].match(/'(\w+)'/g)!.map((s) => s.slice(1, -1)).sort();
      expect(sqlRoles, perm).toEqual([...roles].sort());
    }
  });
});
