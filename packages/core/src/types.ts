// Shared data shapes. Field names match the database columns (snake_case)
// so rows from Supabase can be used directly.

export const CATEGORIES = ['Print Media', 'Flexi Banner', 'Stands & Frames', 'Ink & Solvent'] as const;
export type Category = (typeof CATEGORIES)[number];

export const UNITS = ['Rolls', 'Sheets', 'Pcs', 'Boxes', 'Bags', 'Litres', 'Metres'] as const;
export type Unit = (typeof UNITS)[number];

export const ROLES = ['admin', 'boss', 'manager', 'staff', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export type MoveType = 'in' | 'out' | 'adjust' | 'count' | 'created' | 'removed' | 'edit' | 'void';

export interface Count {
  date: string; // YYYY-MM-DD
  qty: number;
}

export interface Item {
  id: string;
  name: string;
  size: string;
  category: Category;
  unit: Unit;
  qty: number;
  min_level: number;
  note: string;
  sort: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  counts: Count[];
}

export interface Move {
  id: string;
  at: string; // ISO timestamp
  type: MoveType;
  item_id: string | null;
  item_name: string;
  unit: string;
  delta: number;
  metres: number | null;
  balance: number | null;
  client: string;
  job: string;
  note: string;
  user_id: string | null;
  user_name: string;
  voided: boolean;
  voided_by: string | null;
  voided_at: string | null;
}

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface StockRequest {
  id: string;
  created_at: string;
  item_id: string;
  item_name: string;
  qty: number;
  unit: string;
  client: string;
  job: string;
  note: string;
  requested_by: string | null;
  requested_by_name: string;
  status: RequestStatus;
  decided_by: string | null;
  decided_by_name: string;
  decided_at: string | null;
}

export interface Report {
  id: string; // YYYY-MM-DD (Kigali)
  date: string;
  text: string;
  created_at: string;
  source: 'scheduled' | 'manual';
}

export interface Member {
  user_id: string;
  name: string;
  email: string;
  photo: string;
  role: Role;
  last_seen: string | null;
  /** New accounts wait for the Admin (false). Missing = older data, treated as approved. */
  approved?: boolean;
}

// Complimentary jobs and jobs without a sales order (approved by the Boss or Admin).
export const SPECIAL_KINDS = { complimentary: 'Complimentary', no_sales_order: 'No sales order' } as const;
export type SpecialKind = keyof typeof SPECIAL_KINDS;
export const SPECIAL_STAGES = {
  not_started: 'Not started',
  design: 'Design',
  printing: 'Printing',
  finishing: 'Finishing',
  ready: 'Ready',
  delivered: 'Delivered',
} as const;
export type SpecialStage = keyof typeof SPECIAL_STAGES;

export interface SpecialLine {
  material: string;
  width_cm: number;
  height_cm: number;
  qty: number;
}

export interface SpecialUpdate {
  at: string; // ISO
  stage: SpecialStage;
  note: string;
  by: string;
}

export interface SpecialJob {
  id: string;
  kind: SpecialKind;
  client: string;
  job: string;
  job_date: string; // YYYY-MM-DD
  lines: SpecialLine[];
  sqm: number;
  reason: string;
  photos: string[]; // screenshots (storage paths)
  stage: SpecialStage;
  updates: SpecialUpdate[];
  status: RequestStatus;
  decided_by: string | null;
  decided_by_name: string;
  decided_at: string | null;
  decide_note: string;
  invoiced: boolean;
  invoice_no: string;
  invoiced_by_name: string;
  invoiced_at: string | null;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  /** Deleted jobs are kept, with who deleted them, when and why. */
  deleted?: boolean;
  deleted_at?: string | null;
  deleted_by_name?: string;
  delete_reason?: string;
}

/** Square metres of a job's sizes, to 2 decimals. */
export const specialSqm = (lines: SpecialLine[]) =>
  Math.round(lines.reduce((t, l) => t + (l.width_cm * l.height_cm * l.qty) / 10000, 0) * 100) / 100;
