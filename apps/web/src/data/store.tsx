import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Member } from '@fca/core';
import { demoBackend } from './demo';
import { hasSupabase, supabaseBackend } from './supabase';
import { isNetworkError, type Backend } from './backend';
import { applyOp, OpError } from './engine';
import { emptySnapshot, ONLINE_ONLY, type Op, type Snapshot } from './types';
import { t } from '../i18n';

export const backend: Backend = hasSupabase ? supabaseBackend : demoBackend;

const QUEUE_KEY = 'fca.queue.v1';
const CACHE_KEY = 'fca.cache.v1';

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked or full */
  }
}

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error' | 'info';
}

interface StoreValue {
  me: Member | null;
  authReady: boolean;
  data: Snapshot;
  loaded: boolean;
  online: boolean;
  pending: number; // changes waiting to be sent
  /** Validates, shows the change at once, and saves it (now, or when back online). */
  dispatch(op: Op): boolean;
  refresh(): Promise<void>;
  refreshMe(): Promise<void>;
  toasts: Toast[];
  toast(text: string, kind?: Toast['kind']): void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Member | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [server, setServer] = useState<Snapshot>(() => (hasSupabase ? readJSON(CACHE_KEY, emptySnapshot()) : emptySnapshot()));
  const [loaded, setLoaded] = useState(false);
  const [queue, setQueue] = useState<Op[]>(() => (hasSupabase ? readJSON<Op[]>(QUEUE_KEY, []) : []));
  const [online, setOnline] = useState(navigator.onLine);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const flushing = useRef(false);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const meRef = useRef(me);
  meRef.current = me;

  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, text, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await backend.currentMember());
    } catch {
      /* offline: keep the last known user */
    } finally {
      setAuthReady(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!meRef.current) return;
    try {
      const snap = await backend.load();
      setServer(snap);
      setLoaded(true);
      setOnline(true);
      if (hasSupabase) writeJSON(CACHE_KEY, snap);
    } catch (e) {
      if (isNetworkError(e)) setOnline(false);
      setLoaded(true);
    }
  }, []);

  const saveQueue = (q: Op[]) => {
    queueRef.current = q;
    setQueue(q);
    if (hasSupabase) writeJSON(QUEUE_KEY, q);
  };

  const flush = useCallback(async () => {
    if (flushing.current || !meRef.current) return;
    flushing.current = true;
    try {
      while (queueRef.current.length) {
        const op = queueRef.current[0];
        try {
          await backend.run(op, meRef.current);
          setOnline(true);
        } catch (e) {
          if (isNetworkError(e)) {
            setOnline(false);
            break; // try again when back online
          }
          toast(`${t('error.notSaved')}: ${(e as Error).message}`, 'error');
        }
        saveQueue(queueRef.current.slice(1));
      }
    } finally {
      flushing.current = false;
    }
    await refresh();
  }, [refresh, toast]);

  // Sign-in state
  useEffect(() => {
    refreshMe();
    return backend.onAuthChange(() => refreshMe());
  }, [refreshMe]);

  // Load data, live updates, and sending queued changes
  useEffect(() => {
    if (!me) return;
    refresh().then(flush);
    let timer: ReturnType<typeof setTimeout>;
    const unsub = backend.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    });
    const goOnline = () => {
      setOnline(true);
      flush();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const poll = setInterval(() => {
      if (queueRef.current.length) flush();
    }, 20000);
    return () => {
      unsub();
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [me?.user_id, refresh, flush]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the screens show: server data plus changes not yet confirmed.
  const data = useMemo(() => {
    if (!me) return server;
    return queue.reduce((s, op) => {
      try {
        return applyOp(s, op, me);
      } catch {
        return s;
      }
    }, server);
  }, [server, queue, me]);

  const dispatch = useCallback(
    (op: Op) => {
      const user = meRef.current;
      if (!user) return false;
      const needsNet = ONLINE_ONLY.includes(op.kind) || (op.kind === 'saveItem' && !op.item_id && hasSupabase);
      if (needsNet && (!online || !navigator.onLine)) {
        toast(t('error.needsInternet'), 'error');
        return false;
      }
      try {
        applyOp(data, op, user); // same checks as the server, so mistakes show at once
      } catch (e) {
        toast(e instanceof OpError ? e.message : String(e), 'error');
        return false;
      }
      saveQueue([...queueRef.current, op]);
      flush();
      return true;
    },
    [data, flush, online, toast],
  );

  const value: StoreValue = { me, authReady, data, loaded, online, pending: queue.length, dispatch, refresh, refreshMe, toasts, toast };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(StoreContext);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}

export const newId = () => crypto.randomUUID();
