import type { Member, Role } from '@fca/core';
import type { AiMessage, AiReply, Op, Snapshot } from './types';

export interface Backend {
  mode: 'demo' | 'supabase';
  /** The signed-in member, or null. */
  currentMember(): Promise<Member | null>;
  onAuthChange(cb: () => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, name: string): Promise<'signed-in' | 'check-email'>;
  signInWithGoogle(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Demo mode only: sign in as a sample user with this role. */
  demoSignIn?(role: Role): Promise<void>;

  load(): Promise<Snapshot>;
  /** Calls back when data changed on another device. */
  subscribe(onChange: () => void): () => void;
  run(op: Op, me: Member): Promise<unknown>;

  ai(messages: AiMessage[], snapshot: Snapshot, me: Member): Promise<AiReply>;
  writeSummary(snapshot: Snapshot, me: Member): Promise<void>;
  savePushSubscription?(sub: PushSubscription): Promise<void>;
}

/** An error from the server about the request itself (not a lost connection). */
export class ServerError extends Error {}

export function isNetworkError(e: unknown): boolean {
  if (e instanceof ServerError) return false;
  const msg = String((e as Error)?.message ?? e);
  return !navigator.onLine || /fetch|network|load failed|timed? ?out|ECONN/i.test(msg);
}
