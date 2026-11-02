import { useState } from 'react';
import { can, fmtQty, itemLabel, metresToRolls, rollLength, rollsToMetres } from '@fca/core';
import { newId, useStore } from '../data/store';
import { t } from '../i18n';
import { Field, Modal, useItemStats } from './ui';
import { ItemPicker } from './ItemPicker';

/** Stock in / out / adjust. Rolls can be entered in metres. */
export function RecordMovement({ onClose, itemId = null }: { onClose: () => void; itemId?: string | null }) {
  const { me, dispatch, toast } = useStore();
  const { items } = useItemStats();
  const [item, setItem] = useState<string | null>(itemId);
  const [type, setType] = useState<'out' | 'in' | 'adjust'>('out');
  const [qty, setQty] = useState('');
  const [inMetres, setInMetres] = useState(false);
  const [client, setClient] = useState('');
  const [job, setJob] = useState('');
  const [note, setNote] = useState('');

  const it = items.find((i) => i.id === item);
  const len = it ? rollLength(it.unit, it.size) : null;
  const n = Number(qty);
  const rolls = inMetres && len ? metresToRolls(n, len) : n;
  const canAdjust = can(me?.role, 'adjust');

  const submit = () => {
    if (!it) return toast('Choose an item.', 'error');
    if (!qty || !isFinite(n) || (type !== 'adjust' && n <= 0) || n === 0) return toast('Enter a quantity.', 'error');
    const ok = dispatch({
      kind: 'move',
      id: newId(),
      at: new Date().toISOString(),
      item_id: it.id,
      type,
      qty: rolls,
      metres: len ? (inMetres ? n : rollsToMetres(Math.abs(rolls), len)) : null,
      client,
      job,
      note,
    });
    if (ok) {
      toast(`${t(`move.${type}`)}: ${fmtQty(Math.abs(rolls))} ${it.unit} ${itemLabel(it)}`);
      onClose();
    }
  };

  return (
    <Modal
      title={t('dash.record')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={submit}>{t('common.save')}</button>
        </>
      }
    >
      <form className="fields" onSubmit={(e) => (e.preventDefault(), submit())}>
        <div className="full seg" role="radiogroup" aria-label={t('common.type')}>
          {(['out', 'in', ...(canAdjust ? ['adjust'] : [])] as const).map((k) => (
            <button type="button" key={k} role="radio" aria-checked={type === k} className={type === k ? 'on' : ''} onClick={() => setType(k as typeof type)}>
              {t(`move.${k}` as 'move.in')}
            </button>
          ))}
        </div>
        <Field label={t('common.item')} full>
          <ItemPicker items={items} value={item} onChange={setItem} autoFocus={!itemId} />
        </Field>
        {it && (
          <p className="full muted small" style={{ margin: 0 }}>
            In stock: <b>{fmtQty(it.qty)} {it.unit}</b>
            {len ? ` (${fmtQty(rollsToMetres(it.qty, len))} m, ${len} m per roll)` : ''}
          </p>
        )}
        <Field label={type === 'adjust' ? 'Change (+ or −)' : inMetres ? 'Metres' : `${t('common.qty')}${it ? ` (${it.unit})` : ''}`}>
          <input type="number" inputMode="decimal" step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus={!!itemId} />
        </Field>
        {len && type !== 'adjust' ? (
          <Field label="Enter in">
            <div className="seg">
              <button type="button" className={!inMetres ? 'on' : ''} onClick={() => setInMetres(false)}>Rolls</button>
              <button type="button" className={inMetres ? 'on' : ''} onClick={() => setInMetres(true)}>Metres</button>
            </div>
          </Field>
        ) : (
          <span className="hide-sm" />
        )}
        {inMetres && len && n > 0 && <p className="full muted small" style={{ margin: 0 }}>= {fmtQty(rolls)} rolls</p>}
        {type !== 'adjust' && (
          <>
            <Field label={t('common.client')}>
              <input value={client} onChange={(e) => setClient(e.target.value)} maxLength={120} />
            </Field>
            <Field label={t('common.job')}>
              <input value={job} onChange={(e) => setJob(e.target.value)} maxLength={120} />
            </Field>
          </>
        )}
        <Field label={type === 'adjust' ? `${t('common.reason')} (required)` : t('common.note')} full>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function RequestMaterial({ onClose }: { onClose: () => void }) {
  const { dispatch, toast } = useStore();
  const { items } = useItemStats();
  const [item, setItem] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [client, setClient] = useState('');
  const [job, setJob] = useState('');
  const [note, setNote] = useState('');
  const it = items.find((i) => i.id === item);

  const submit = () => {
    if (!it) return toast('Choose an item.', 'error');
    const n = Number(qty);
    if (!(n > 0)) return toast('Enter a quantity.', 'error');
    if (dispatch({ kind: 'request', id: newId(), item_id: it.id, qty: n, client, job, note })) {
      toast('Request sent for approval');
      onClose();
    }
  };

  return (
    <Modal
      title={t('dash.request')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={submit}>{t('req.new')}</button>
        </>
      }
    >
      <form className="fields" onSubmit={(e) => (e.preventDefault(), submit())}>
        <Field label={t('common.item')} full>
          <ItemPicker items={items} value={item} onChange={setItem} autoFocus />
        </Field>
        <Field label={`${t('common.qty')}${it ? ` (${it.unit})` : ''}`}>
          <input type="number" inputMode="decimal" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <span className="hide-sm" />
        <Field label={t('common.client')}>
          <input value={client} onChange={(e) => setClient(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t('common.job')}>
          <input value={job} onChange={(e) => setJob(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t('common.note')} full>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
