import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { can, CATEGORIES, fmtCover, fmtQty, kigaliDay, matchesSearch, recentPoints, type Item, type Status } from '@fca/core';
import { newId, useStore } from '../data/store';
import { exportStock } from '../lib/exports';
import { t } from '../i18n';
import { Empty, StatusPill, Sparkline, useItemStats } from '../components/ui';
import { ItemEditor } from '../components/ItemEditor';
import { RecordMovement } from '../components/MovementForms';

export function Stock() {
  const { data, me, dispatch, toast } = useStore();
  const { items, stats } = useItemStats();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const status = (params.get('status') as Status | null) ?? 'all';
  const [editing, setEditing] = useState<Item | null | 'new'>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [take, setTake] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [takeDate, setTakeDate] = useState(kigaliDay());

  const setStatus = (s: string) => {
    if (s === 'all') params.delete('status');
    else params.set('status', s);
    setParams(params, { replace: true });
  };

  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          matchesSearch(i, query) &&
          (category === 'all' || i.category === category) &&
          (status === 'all' || stats.get(i.id)?.status === status),
      ),
    [items, stats, query, category, status],
  );

  const changed = Object.entries(counts).filter(([id, v]) => {
    const item = items.find((i) => i.id === id);
    return v !== '' && item && Number(v) !== item.qty;
  }).length;

  const startTake = () => {
    setCounts(Object.fromEntries(items.map((i) => [i.id, String(i.qty)])));
    setTake(true);
  };

  const saveTake = () => {
    const list = Object.entries(counts)
      .filter(([, v]) => v !== '' && isFinite(Number(v)))
      .map(([item_id, v]) => ({ item_id, qty: Number(v) }));
    if (list.some((c) => c.qty < 0)) return toast('Counts must be 0 or more.', 'error');
    if (!confirm(`Save the stock take for ${list.length} items (${changed} changed)?`)) return;
    if (dispatch({ kind: 'stocktake', id: newId(), date: takeDate, counts: list })) {
      toast(`Stock take saved: ${changed} changed`);
      setTake(false);
    }
  };

  const remove = (i: Item) => {
    const reason = prompt(`Remove ${i.name} ${i.size}? It stays in the movement log.\n\nReason (optional):`);
    if (reason === null) return;
    if (dispatch({ kind: 'removeItem', id: newId(), item_id: i.id, reason })) toast('Item removed');
  };

  const canItems = can(me?.role, 'items');

  return (
    <>
      <div className="page-head">
        <h1>{take ? t('stock.takeMode') : t('nav.stock')}</h1>
        <span className="spacer" />
        {take ? (
          <>
            <label className="row small muted">
              {t('stock.takeDate')}
              <input type="date" value={takeDate} max={kigaliDay()} onChange={(e) => setTakeDate(e.target.value)} style={{ width: 'auto' }} />
            </label>
            <span className="pill low">{t('stock.changed', { n: changed })}</span>
            <button className="btn" onClick={() => setTake(false)}>{t('common.cancel')}</button>
            <button className="btn primary" onClick={saveTake}>{t('stock.saveTake')}</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => exportStock(data.items)}>{t('common.export')}</button>
            {can(me?.role, 'stocktake') && <button className="btn" onClick={startTake}>{t('stock.takeMode')}</button>}
            {canItems && <button className="btn primary" onClick={() => setEditing('new')}>{t('stock.add')}</button>}
          </>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <input className="search" type="search" placeholder={`${t('common.search')}… e.g. glossy 1.27`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('common.search')} />
          <div className="chips" role="group" aria-label={t('common.category')}>
            {['all', ...CATEGORIES].map((c) => (
              <button key={c} className={`chip${category === c ? ' on' : ''}`} onClick={() => setCategory(c)} aria-pressed={category === c}>
                {c === 'all' ? t('common.all') : c}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <div className="chips" role="group" aria-label={t('common.status')}>
            {(['all', 'out', 'low', 'ok'] as const).map((s) => (
              <button key={s} className={`chip${status === s ? ' on' : ''}`} onClick={() => setStatus(s)} aria-pressed={status === s}>
                {s === 'all' ? t('common.all') : t(`status.${s}`)}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead>
                <tr>
                  <th>{t('common.item')}</th>
                  <th>{t('common.size')}</th>
                  <th className="num">{t('common.inStock')}</th>
                  {take ? <th>Count</th> : <th>{t('common.status')}</th>}
                  <th className="num">{t('common.minimum')}</th>
                  <th className="num">{t('common.usePerWeek')}</th>
                  <th className="num">{t('common.cover')}</th>
                  <th>{t('stock.history')}</th>
                  {!take && <th />}
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((cat) => {
                  const rows = visible.filter((i) => i.category === cat);
                  if (!rows.length) return null;
                  return (
                    <Fragment key={cat}>
                      <tr className="group">
                        <td colSpan={9}>
                          {cat} <span className="muted">({rows.length})</span>
                        </td>
                      </tr>
                      {rows.map((i) => {
                        const s = stats.get(i.id)!;
                        const isChanged = take && counts[i.id] !== '' && counts[i.id] !== undefined && Number(counts[i.id]) !== i.qty;
                        return (
                          <tr key={i.id} className={isChanged ? 'changed' : ''}>
                            <td className="first">
                              {i.name}
                              {i.note && <div className="muted small">{i.note}</div>}
                            </td>
                            <td data-label={t('common.size')}>{i.size}</td>
                            <td className="num" data-label={t('common.inStock')}>
                              <span>
                                {fmtQty(i.qty)} <span className="muted small">{i.unit}</span>
                              </span>
                            </td>
                            {take ? (
                              <td data-label="Count">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min="0"
                                  step="any"
                                  style={{ width: 90 }}
                                  aria-label={`Count for ${i.name} ${i.size}`}
                                  value={counts[i.id] ?? ''}
                                  onChange={(e) => setCounts((c) => ({ ...c, [i.id]: e.target.value }))}
                                />
                              </td>
                            ) : (
                              <td data-label={t('common.status')}>
                                <StatusPill status={s.status} />
                              </td>
                            )}
                            <td className="num" data-label={t('common.minimum')}>{fmtQty(i.min_level)}</td>
                            <td className="num" data-label={t('common.usePerWeek')}>{s.weeklyUse > 0 ? fmtQty(Math.round(s.weeklyUse * 10) / 10) : '–'}</td>
                            <td className="num" data-label={t('common.cover')}>{fmtCover(s.cover)}</td>
                            <td data-label={t('stock.history')}>
                              <Sparkline values={recentPoints(i.counts, 8).map((c) => c.qty)} />
                            </td>
                            {!take && (
                              <td className="actions">
                                {can(me?.role, 'stock') && (
                                  <button className="btn small" onClick={() => setMoving(i.id)} aria-label={`Record movement for ${i.name} ${i.size}`}>
                                    ±
                                  </button>
                                )}
                                {canItems && (
                                  <>
                                    <button className="btn small ghost" onClick={() => setEditing(i)} aria-label={`${t('common.edit')} ${i.name} ${i.size}`}>
                                      ✎
                                    </button>
                                    <button className="btn small ghost danger" onClick={() => remove(i)} aria-label={`${t('common.remove')} ${i.name} ${i.size}`}>
                                      🗑
                                    </button>
                                  </>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <ItemEditor item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {moving && <RecordMovement itemId={moving} onClose={() => setMoving(null)} />}
    </>
  );
}
