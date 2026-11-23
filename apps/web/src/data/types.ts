import type { Category, Count, Item, Member, Move, Report, Role, SpecialJob, SpecialKind, SpecialLine, SpecialStage, SqmMaterial, StockRequest, Unit } from '@fca/core';

export interface Snapshot {
  items: Item[];
  moves: Move[]; // newest first
  requests: StockRequest[]; // newest first
  reports: Report[]; // newest first
  members: Member[];
  sqmMaterials: SqmMaterial[]; // job calculator materials
  specialJobs: SpecialJob[]; // complimentary / no sales order jobs, newest first
}

export const emptySnapshot = (): Snapshot => ({ items: [], moves: [], requests: [], reports: [], members: [], sqmMaterials: [], specialJobs: [] });

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
  | { kind: 'approveMember'; id: string; user_id: string; approve: boolean }
  | { kind: 'import'; id: string; rows: ImportRow[] }
  | { kind: 'saveSqmMaterials'; id: string; materials: SqmMaterial[] }
  | { kind: 'saveSpecial'; id: string; job_id: string; fields: SpecialFields }
  | { kind: 'specialStage'; id: string; job_id: string; stage: SpecialStage; note: string; at: string }
  | { kind: 'decideSpecial'; id: string; job_id: string; approve: boolean; note: string }
  | { kind: 'invoiceSpecial'; id: string; job_id: string; invoiced: boolean; invoice_no: string }
  | { kind: 'deleteSpecial'; id: string; job_id: string; reason: string };

export interface SpecialFields {
  kind: SpecialKind;
  client: string;
  job: string;
  job_date: string;
  lines: SpecialLine[];
  reason: string;
  photos: string[];
}

/** Ops that need the internet right away (not queued offline). */
export const ONLINE_ONLY: Op['kind'][] = ['setRole', 'approveMember', 'import'];

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
