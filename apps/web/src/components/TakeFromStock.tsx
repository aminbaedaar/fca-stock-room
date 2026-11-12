import { useState } from 'react';
import { can, fmtQty, itemLabel, parseRollSize, round, type TakeLine } from '@fca/core';
import { newId, useStore } from '../data/store';
import { applyOp, OpError } from '../data/engine';
import type { Op } from '../data/types';
import { t } from '../i18n';
import { Field, Modal } from './ui';

/** Records the calculator's "stock to pull" as stock-outs, after the user checks each line. */
export function TakeFromStock({ lines, client: client0, job: job0, onClose }: { lines: TakeLine[]; client: string; job: string; onClose: () => void }) {
  const { data, me, dispatch, toast } = useStore();
  const [rows, setRows] = useState(() => lines.map((l) => ({ ...l, take: true, qtyText: String(l.qty) })));
  const [client, setClient] = useState(client0);
  const [job, setJob] = useState(job0);
  const [remember, setRemember] = useState(true);
  const items = data.items.filter((i) => i.active);

  const setRow = (key: string, p: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const pickItem = (r: (typeof rows)[number], itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    const len = item ? parseRollSize(item.size)?.length : null;
    // Rolls: convert the metres to this roll's length; sheets keep their count.
    const qty = r.metres != null && len ? round(r.metres / len, 4) : r.metres != null ? r.metres : r.qty;
    setRow(r.key, { item_id: itemId || null, qty, qtyText: String(qty) });
  };

  const confirmTake = () => {
    if (!me) return;
    const chosen = rows.filter((r) => r.take);
    if (!chosen.length) return toast('Nothing selected.', 'error');
    if (chosen.some((r) => !r.item_id)) return toast('Choose the stock item for every line you take.', 'error');
    const ops: Op[] = chosen.map((r) => ({
      kind: 'move',
      id: newId(),
      at: new Date().toISOString(),
      item_id: r.item_id!,
      type: 'out',
      qty: Number(r.qtyText),
      metres: r.metres,
      client,
      job,
      note: `Job calculator: ${r.label}, ${r.useTxt}`,
    }));
    // Check all lines together first, so nothing is half-recorded.
    try {
      ops.reduce((s, op) => applyOp(s, op, me), data);
    } catch (e) {
      return toast(e instanceof OpError ? e.message : String(e), 'error');
    }
    ops.forEach((op) => dispatch(op));

    if (remember && can(me.role, 'items')) {
      const byMat = new Map(data.sqmMaterials.map((m) => [m.id, { ...m, links: { ...m.links } }]));
      for (const r of chosen) {
        const [matId, w] = r.key.split('|');
        const m = byMat.get(matId);
        if (m) m.links[w === 'sheet' ? 'sheet' : w] = r.item_id!;
      }
      dispatch({ kind: 'saveSqmMaterials', id: newId(), materials: [...byMat.values()] });
    }
    toast(`Recorded ${ops.length} stock out${ops.length === 1 ? '' : 's'}${job ? ` for ${job}` : ''}`);
    onClose();
  };

  return (
    <Modal
      title="Take from stock"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={confirmTake}>Record stock out</button>
        </>
      }
    >
      <div className="fields">
        <Field label={t('common.client')}><input value={client} onChange={(e) => setClient(e.target.value)} maxLength={120} /></Field>
        <Field label={t('common.job')}><input value={job} onChange={(e) => setJob(e.target.value)} maxLength={120} /></Field>
      </div>
      <div className="stack" style={{ marginTop: 12 }}>
        {rows.map((r) => {
          const item = items.find((i) => i.id === r.item_id);
          const unit = r.metres != null ? 'Rolls' : 'Sheets';
          const short = item && item.qty < Number(r.qtyText);
          return (
            <div className="sqm-take" key={r.key}>
              <label className="row" style={{ fontWeight: 600 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={r.take} onChange={(e) => setRow(r.key, { take: e.target.checked })} />
                {r.label} · {r.useTxt}
              </label>
              {r.take && (
                <div className="fields">
                  <Field label="Take from">
                    <select value={r.item_id ?? ''} onChange={(e) => pickItem(r, e.target.value)}>
                      <option value="">Choose stock item…</option>
                      {items.filter((i) => i.unit === unit).map((i) => <option key={i.id} value={i.id}>{itemLabel(i)} ({fmtQty(i.qty)} in stock)</option>)}
                    </select>
                  </Field>
                  <Field label={`${t('common.qty')}${item ? ` (${item.unit})` : ''}`}>
                    <input type="number" inputMode="decimal" min="0" step="any" value={r.qtyText} onChange={(e) => setRow(r.key, { qtyText: e.target.value })} />
                  </Field>
                  {short && <p className="full err" style={{ margin: 0 }}>Only {fmtQty(item!.qty)} {item!.unit} in stock.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {can(me?.role, 'items') && (
        <label className="row small" style={{ marginTop: 12 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember these stock items for next time
        </label>
      )}
    </Modal>
  );
}
