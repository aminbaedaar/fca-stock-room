import { can, itemLabel, kigaliDay, round, type Item, type Member, type Move, type Permission } from '@fca/core';
import { fmtDate } from '@fca/core';
import type { Op, Snapshot } from './types';

// Applies an op to a snapshot using the same rules as the database functions
// in supabase/migrations/0002_functions.sql. Used for demo mode and to show
// changes instantly (also while offline) before the server confirms them.

export class OpError extends Error {}

function require(me: Member, perm: Permission) {
  if (!can(me.role, perm)) throw new OpError(`Your role is not allowed to do this (${perm}).`);
}

const clean = (s: string | undefined, n: number) => (s ?? '').trim().slice(0, n);
const nameOf = (me: Member) => me.name || me.email;

function newMove(me: Member, p: Partial<Move> & Pick<Move, 'id' | 'type'>): Move {
  return {
    at: new Date().toISOString(),
    item_id: null,
    item_name: '',
    unit: '',
    delta: 0,
    metres: null,
    balance: null,
    client: '',
    job: '',
    note: '',
    user_id: me.user_id,
    user_name: nameOf(me),
    voided: false,
    voided_by: null,
    voided_at: null,
    ...p,
  };
}

function setItem(s: Snapshot, item: Item): Snapshot {
  return { ...s, items: s.items.map((i) => (i.id === item.id ? item : i)) };
}

function applyStock(s: Snapshot, me: Member, id: string, itemId: string, type: Move['type'], delta: number, extra: Partial<Move>): Snapshot {
  const item = s.items.find((i) => i.id === itemId && i.active);
  if (!item) throw new OpError('Item not found.');
  if (item.qty + delta < -1e-9) throw new OpError(`Not enough stock: only ${round(item.qty, 3)} ${item.unit} of ${itemLabel(item)} left.`);
  const updated = { ...item, qty: round(item.qty + delta, 3), updated_at: new Date().toISOString() };
  const move = newMove(me, { id, type, item_id: item.id, item_name: itemLabel(updated), unit: item.unit, delta: round(delta, 3), balance: updated.qty, ...extra });
  return { ...setItem(s, updated), moves: [move, ...s.moves] };
}

export function applyOp(s: Snapshot, op: Op, me: Member): Snapshot {
  switch (op.kind) {
    case 'move': {
      if (s.moves.some((m) => m.id === op.id)) return s;
      if (op.type === 'adjust') {
        require(me, 'adjust');
        if (!op.qty) throw new OpError('Enter a change other than 0.');
        if (!op.note.trim()) throw new OpError('Please give a reason for the adjustment.');
      } else {
        require(me, 'stock');
        if (!(op.qty > 0)) throw new OpError('Enter a quantity above 0.');
      }
      const delta = op.type === 'out' ? -op.qty : op.qty;
      const at = op.at && op.at < new Date().toISOString() ? op.at : new Date().toISOString();
      return applyStock(s, me, op.id, op.item_id, op.type, delta, {
        at,
        metres: op.metres,
        client: clean(op.client, 120),
        job: clean(op.job, 120),
        note: clean(op.note, 500),
      });
    }

    case 'stocktake': {
      require(me, 'stocktake');
      if (s.moves.some((m) => m.id.startsWith(op.id))) return s;
      if (op.date > kigaliDay()) throw new OpError('Stock take date cannot be in the future.');
      let next = s;
      op.counts.forEach(({ item_id, qty }, n) => {
        if (!(qty >= 0)) throw new OpError('Counts must be 0 or more.');
        const item = next.items.find((i) => i.id === item_id && i.active);
        if (!item) return;
        const counts = [...item.counts.filter((c) => c.date !== op.date), { date: op.date, qty }].sort((a, b) => (a.date < b.date ? -1 : 1));
        const delta = round(qty - item.qty, 3);
        next = setItem(next, { ...item, counts, qty });
        if (delta !== 0) {
          const move = newMove(me, {
            id: `${op.id}-${n}`,
            type: 'count',
            item_id,
            item_name: itemLabel(item),
            unit: item.unit,
            delta,
            balance: qty,
            note: `Stock take ${fmtDate(op.date)}`,
          });
          next = { ...next, moves: [move, ...next.moves] };
        }
      });
      return next;
    }

    case 'saveItem': {
      require(me, 'items');
      if (s.moves.some((m) => m.id === op.id)) return s;
      const f = op.fields;
      if (!f.name.trim()) throw new OpError('Item name is required.');
      if (f.min_level < 0 || op.qty < 0) throw new OpError('Numbers must be 0 or more.');
      const now = new Date().toISOString();
      const fields = { ...f, name: clean(f.name, 120).toUpperCase(), size: clean(f.size, 40).toUpperCase(), note: clean(f.note, 500) };
      if (!op.item_id) {
        const item: Item = {
          id: `local-${op.id}`,
          ...fields,
          qty: op.qty,
          sort: Math.max(0, ...s.items.map((i) => i.sort)) + 1,
          active: true,
          created_at: now,
          updated_at: now,
          counts: [],
        };
        const move = newMove(me, { id: op.id, type: 'created', item_id: item.id, item_name: itemLabel(item), unit: item.unit, delta: item.qty, balance: item.qty, note: 'Item added' });
        return { ...s, items: [...s.items, item], moves: [move, ...s.moves] };
      }
      const old = s.items.find((i) => i.id === op.item_id && i.active);
      if (!old) throw new OpError('Item not found.');
      const item = { ...old, ...fields, updated_at: now };
      const changes: string[] = [];
      if (old.name !== item.name) changes.push(`name ${old.name} → ${item.name}`);
      if (old.size !== item.size) changes.push(`size ${old.size} → ${item.size}`);
      if (old.category !== item.category) changes.push(`category → ${item.category}`);
      if (old.unit !== item.unit) changes.push(`unit ${old.unit} → ${item.unit}`);
      if (old.min_level !== item.min_level) changes.push(`minimum ${old.min_level} → ${item.min_level}`);
      if (old.note !== item.note) changes.push('note');
      const move = newMove(me, { id: op.id, type: 'edit', item_id: item.id, item_name: itemLabel(item), unit: item.unit, balance: item.qty, note: `Edited: ${changes.join('; ') || 'no changes'}` });
      return { ...setItem(s, item), moves: [move, ...s.moves] };
    }

    case 'removeItem': {
      require(me, 'items');
      if (s.moves.some((m) => m.id === op.id)) return s;
      const item = s.items.find((i) => i.id === op.item_id && i.active);
      if (!item) throw new OpError('Item not found.');
      const move = newMove(me, { id: op.id, type: 'removed', item_id: item.id, item_name: itemLabel(item), unit: item.unit, balance: item.qty, note: clean(op.reason, 500) || 'Item removed' });
      return { ...setItem(s, { ...item, active: false }), moves: [move, ...s.moves] };
    }

    case 'void': {
      require(me, 'void');
      if (s.moves.some((m) => m.id === op.id)) return s;
      const orig = s.moves.find((m) => m.id === op.move_id);
      if (!orig) throw new OpError('Movement not found.');
      if (orig.voided) throw new OpError('This movement is already reversed.');
      if (!['in', 'out', 'adjust', 'count'].includes(orig.type)) throw new OpError('Only stock in, out, adjust and count movements can be reversed.');
      const item = s.items.find((i) => i.id === orig.item_id);
      if (!item) throw new OpError('Item not found.');
      if (item.qty - orig.delta < -1e-9) throw new OpError(`Cannot reverse: stock would go below 0 (${item.qty} ${item.unit} left).`);
      const updated = { ...item, qty: round(item.qty - orig.delta, 3) };
      const now = new Date().toISOString();
      const move = newMove(me, {
        id: op.id,
        type: 'void',
        item_id: item.id,
        item_name: itemLabel(item),
        unit: item.unit,
        delta: -orig.delta,
        balance: updated.qty,
        client: orig.client,
        job: orig.job,
        note: `Reversed ${orig.type} of ${fmtDate(orig.at)}`,
      });
      const moves = s.moves.map((m) => (m.id === orig.id ? { ...m, voided: true, voided_by: me.user_id, voided_at: now } : m));
      return { ...setItem(s, updated), moves: [move, ...moves] };
    }

    case 'request': {
      require(me, 'request');
      if (s.requests.some((r) => r.id === op.id)) return s;
      if (!(op.qty > 0)) throw new OpError('Enter a quantity above 0.');
      const item = s.items.find((i) => i.id === op.item_id && i.active);
      if (!item) throw new OpError('Item not found.');
      return {
        ...s,
        requests: [
          {
            id: op.id,
            created_at: new Date().toISOString(),
            item_id: item.id,
            item_name: itemLabel(item),
            qty: op.qty,
            unit: item.unit,
            client: clean(op.client, 120),
            job: clean(op.job, 120),
            note: clean(op.note, 500),
            requested_by: me.user_id,
            requested_by_name: nameOf(me),
            status: 'pending',
            decided_by: null,
            decided_by_name: '',
            decided_at: null,
          },
          ...s.requests,
        ],
      };
    }

    case 'decide': {
      require(me, 'approve');
      const req = s.requests.find((r) => r.id === op.request_id);
      if (!req) throw new OpError('Request not found.');
      if (req.status !== 'pending') {
        if (s.moves.some((m) => m.id === op.id) || (req.status === 'rejected' && !op.approve)) return s;
        throw new OpError(`This request was already ${req.status}.`);
      }
      let next = s;
      if (op.approve) {
        next = applyStock(s, me, op.id, req.item_id, 'out', -req.qty, {
          client: req.client,
          job: req.job,
          note: `Request by ${req.requested_by_name}${req.note ? `: ${req.note}` : ''}`,
        });
      }
      const decided = { ...req, status: op.approve ? 'approved' : 'rejected', decided_by: me.user_id, decided_by_name: nameOf(me), decided_at: new Date().toISOString() } as const;
      return { ...next, requests: next.requests.map((r) => (r.id === req.id ? decided : r)) };
    }

    case 'setRole': {
      require(me, 'roles');
      const target = s.members.find((m) => m.user_id === op.user_id);
      if (!target) throw new OpError('User not found.');
      if (op.role !== 'admin' && target.role === 'admin' && s.members.filter((m) => m.role === 'admin').length <= 1)
        throw new OpError('There must always be at least one Admin.');
      return { ...s, members: s.members.map((m) => (m.user_id === op.user_id ? { ...m, role: op.role } : m)) };
    }

    case 'saveSqmMaterials': {
      require(me, 'items');
      if (!op.materials.length) throw new OpError('The materials list cannot be empty.');
      if (op.materials.some((m) => !m.name.trim())) throw new OpError('Every material needs a name.');
      return { ...s, sqmMaterials: op.materials.map((m) => ({ ...m, name: clean(m.name, 80) })) };
    }

    case 'import': {
      require(me, 'import');
      let next = s;
      let sort = Math.max(0, ...s.items.map((i) => i.sort));
      op.rows.forEach((row, n) => {
        const name = row.name.trim().toUpperCase();
        const size = row.size.trim().toUpperCase();
        const existing = next.items.find((i) => i.active && i.name === name && i.size === size);
        const now = new Date().toISOString();
        if (existing) {
          const have = new Set(existing.counts.map((c) => c.date));
          const counts = [...existing.counts, ...row.counts.filter((c) => !have.has(c.date))].sort((a, b) => (a.date < b.date ? -1 : 1));
          next = setItem(next, { ...existing, counts });
          return;
        }
        const item: Item = { id: `local-${op.id}-${n}`, ...row, name, size, sort: ++sort, active: true, created_at: now, updated_at: now };
        const move = newMove(me, { id: `${op.id}-${n}`, type: 'created', item_id: item.id, item_name: itemLabel(item), unit: item.unit, delta: item.qty, balance: item.qty, note: 'Imported from Excel' });
        next = { ...next, items: [...next.items, item], moves: [move, ...next.moves] };
      });
      return next;
    }
  }
}
