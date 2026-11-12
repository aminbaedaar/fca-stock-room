import type { Role } from './types.ts';

// The permission table. The database enforces the same table in
// supabase/migrations/0002_functions.sql (function fca_can); keep both in step.
export type Permission =
  | 'view' // see stock, movements, dashboard, team, AI assistant
  | 'calculator' // use the job calculator
  | 'request'
  | 'stock' // stock in / stock out
  | 'adjust' // manual adjustments
  | 'items' // add, edit, remove items
  | 'approve' // approve / reject requests
  | 'stocktake'
  | 'summary' // write the Monday summary now
  | 'import'
  | 'void'
  | 'roles'
  | 'backup';

const TABLE: Record<Permission, Role[]> = {
  view: ['admin', 'boss', 'manager', 'staff', 'viewer'],
  calculator: ['admin', 'boss', 'manager', 'staff', 'viewer', 'calculator'],
  request: ['admin', 'boss', 'manager', 'staff'],
  stock: ['admin', 'boss', 'manager', 'staff'],
  adjust: ['admin', 'boss', 'manager'],
  items: ['admin', 'boss', 'manager'],
  approve: ['admin', 'boss', 'manager'],
  stocktake: ['admin', 'boss', 'manager'],
  summary: ['admin', 'boss', 'manager'],
  import: ['admin'],
  void: ['admin'],
  roles: ['admin'],
  backup: ['admin'],
};

export function can(role: Role | null | undefined, perm: Permission): boolean {
  return !!role && TABLE[perm].includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  boss: 'Boss',
  manager: 'Manager',
  staff: 'Staff',
  viewer: 'Viewer',
  calculator: 'Calculator only',
};

/** What each role is for, shown when choosing a role. */
export const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including roles, import and reversing movements',
  boss: 'Runs the stock (same as Manager)',
  manager: 'Runs the stock: items, approvals, stock take',
  staff: 'Stock in and out, requests, job calculator',
  viewer: 'Looks only: stock, movements, job calculator',
  calculator: 'Only the job calculator: no stock, movements or team',
};

// Rows shown on the Team & roles screen.
export const PERMISSION_ROWS: { label: string; perm: Permission }[] = [
  { label: 'Use the job calculator (SQM & wastage, PDF report)', perm: 'calculator' },
  { label: 'See stock, movements, dashboard, AI assistant', perm: 'view' },
  { label: 'Request material for a job', perm: 'request' },
  { label: 'Stock in / stock out', perm: 'stock' },
  { label: 'Adjust stock, add / edit / remove items', perm: 'items' },
  { label: 'Approve or reject requests, weekly stock take', perm: 'approve' },
  { label: 'Write the Monday summary now', perm: 'summary' },
  { label: 'Reverse (void) a movement, set roles, import, backup', perm: 'void' },
];

export const PERMISSION_TABLE = TABLE;
