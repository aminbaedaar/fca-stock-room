import type { Category, Count, Item, Member, Move, Report, Role, SqmMaterial, StockRequest, Unit } from '@fca/core';

export interface Snapshot {
  items: Item[];
  moves: Move[]; // newest first
  requests: StockRequest[]; // newest first
  reports: Report[]; // newest first
  members: Member[];
  sqmMaterials: SqmMaterial[]; // job calculator materials
}

export const emptySnapshot = (): Snapshot => ({ items: [], moves: [], requests: [], reports: [], members: [], sqmMaterials: [] });

export interface ItemFields {
  name: string;
  size: string;
  category: Category;
  unit: Unit;
  min_level: number;
  note: string;
}

export interface ImportRow extends ItemFields {
  qty: number;
  counts: Count[];
}

// Every change is an "op" with an id made on the device, so an op that is
// sent twice (e.g. after the internet comes back) is only saved once.
export type Op =
  | { kind: 'move'; id: string; at: string; item_id: string; type: 'in' | 'out' | 'adjust'; qty: number; metres: number | null; client: string; job: string; note: string }
  | { kind: 'stocktake'; id: string; date: string; counts: { item_id: string; qty: number }[] }
  | { kind: 'saveItem'; id: string; item_id: string | null; fields: ItemFields; qty: number }
  | { kind: 'removeItem'; id: string; item_id: string; reason: string }
  | { kind: 'void'; id: string; move_id: string; reason: string }
  | { kind: 'request'; id: string; item_id: string; qty: number; client: string; job: string; note: string }
  | { kind: 'decide'; id: string; request_id: string; approve: boolean }
  | { kind: 'setRole'; id: string; user_id: string; role: Role }
  | { kind: 'import'; id: string; rows: ImportRow[] }
  | { kind: 'saveSqmMaterials'; id: string; materials: SqmMaterial[] };

/** Ops that need the internet right away (not queued offline). */
export const ONLINE_ONLY: Op['kind'][] = ['setRole', 'import'];

export interface AiProposal {
  tool_use_id: string;
  item_id: string;
  type: 'in' | 'out';
  qty: number;
  metres: number | null;
  client: string;
  job: string;
  note: string;
}

export interface AiReply {
  text: string;
  proposals: AiProposal[];
  /** Raw assistant content, sent back unchanged with the next question. */
  assistant_content: unknown[];
}

export type AiMessage = { role: 'user' | 'assistant'; content: unknown };
