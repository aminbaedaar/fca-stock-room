import { buildMondayReport, FCA_SQM_MATERIALS, kigaliDay, ROLE_LABELS, type Item, type Member, type Role } from '@fca/core';
import seed from '../demo/seed.json';
import { applyOp } from './engine';
import type { Backend } from './backend';
import type { Snapshot } from './types';
import { localAssistant } from './localAssistant';

// Demo mode: runs fully in the browser with your imported Excel data, so the
// app can be tried before the Supabase database is set up. Data is kept in
// this browser only. Other tabs update live through the storage event.

const KEY = 'fca.demo.v1';
const USER_KEY = 'fca.demo.user';

const DEMO_MEMBERS: Member[] = (['admin', 'boss', 'manager', 'staff', 'viewer'] as Role[]).map((role) => ({
  user_id: `demo-${role}`,
  name: `Demo ${ROLE_LABELS[role]}`,
  email: `${role}@demo.fca`,
  photo: '',
  role,
  last_seen: null,
}));

function initial(): Snapshot {
  const now = new Date().toISOString();
  const items: Item[] = (seed as Omit<Item, 'id' | 'active' | 'created_at' | 'updated_at'>[]).map((s, n) => ({
    ...s,
    id: `item-${n + 1}`,
    active: true,
    created_at: now,
    updated_at: now,
  })) as Item[];
  return { items, moves: [], requests: [], reports: [], members: DEMO_MEMBERS, sqmMaterials: FCA_SQM_MATERIALS };
}

function read(): Snapshot {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { sqmMaterials: FCA_SQM_MATERIALS, ...JSON.parse(raw) };
  } catch {
    /* fall through */
  }
  return initial();
}

function write(s: Snapshot) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
  memory = s;
}

let memory: Snapshot | null = null;
const authListeners = new Set<() => void>();

export function resetDemo() {
  localStorage.removeItem(KEY);
  memory = null;
}

export const demoBackend: Backend = {
  mode: 'demo',
  async currentMember() {
    const id = localStorage.getItem(USER_KEY);
    return (memory ?? read()).members.find((m) => m.user_id === id) ?? null;
  },
  onAuthChange(cb) {
    authListeners.add(cb);
    return () => authListeners.delete(cb);
  },
  async demoSignIn(role) {
    localStorage.setItem(USER_KEY, `demo-${role}`);
    authListeners.forEach((f) => f());
  },
  async signIn() {
    throw new Error('Demo mode: choose a demo role below.');
  },
  async signUp() {
    throw new Error('Demo mode: choose a demo role below.');
  },
  async signInWithGoogle() {
    throw new Error('Google sign-in works once Supabase is set up.');
  },
  async sendPasswordReset() {
    throw new Error('Password reset works once Supabase is set up.');
  },
  async updatePassword() {},
  async signOut() {
    localStorage.removeItem(USER_KEY);
    authListeners.forEach((f) => f());
  },

  async load() {
    memory = memory ?? read();
    return memory;
  },
  subscribe(onChange) {
    const h = (e: StorageEvent) => {
      if (e.key === KEY) {
        memory = null;
        onChange();
      }
    };
    window.addEventListener('storage', h);
    return () => window.removeEventListener('storage', h);
  },
  async run(op, me) {
    write(applyOp(memory ?? read(), op, me));
  },

  async ai(messages, snapshot, me) {
    return localAssistant(messages, snapshot, me);
  },
  async writeSummary(snapshot) {
    const id = kigaliDay();
    const report = { id, date: id, text: buildMondayReport(snapshot), created_at: new Date().toISOString(), source: 'manual' as const };
    const s = memory ?? read();
    write({ ...s, reports: [report, ...s.reports.filter((r) => r.id !== id)] });
  },
};
