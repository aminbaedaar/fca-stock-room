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
}
