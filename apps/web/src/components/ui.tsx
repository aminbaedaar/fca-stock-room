import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { itemStats, type Item, type ItemStats, type Member, type Status, type MoveType } from '@fca/core';
import { useStore } from '../data/store';
import { t } from '../i18n';

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.close)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <span className="spacer" />
          <button className="btn ghost icon close" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: Status }) {
  return <span className={`pill ${status}`}>{t(`status.${status}`)}</span>;
}

export function MoveTypeLabel({ type }: { type: MoveType }) {
  return <span className="type">{t(`move.${type}`)}</span>;
}

export function Sparkline({ values, width = 80, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="muted small">–</span>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Last counts: ${values.join(', ')}`}>
      <polyline points={pts} />
    </svg>
  );
}

export function Avatar({ member, size = 32 }: { member: Pick<Member, 'name' | 'email' | 'photo'>; size?: number }) {
  const initials = (member.name || member.email || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden>
      {member.photo ? <img src={member.photo} alt="" referrerPolicy="no-referrer" /> : initials}
    </span>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind}`}>
          {x.text}
        </div>
      ))}
    </div>
  );
}

export function Field({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={`field${full ? ' full' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Active items with their calculated numbers, computed once per data change. */
export function useItemStats(): { items: Item[]; stats: Map<string, ItemStats> } {
  const { data } = useStore();
  return useMemo(() => {
    const items = data.items.filter((i) => i.active).sort((a, b) => a.sort - b.sort);
    return { items, stats: new Map(items.map((i) => [i.id, itemStats(i)])) };
  }, [data.items]);
}

export function Empty({ children }: { children?: ReactNode }) {
  return <p className="muted">{children ?? t('common.noResults')}</p>;
}
