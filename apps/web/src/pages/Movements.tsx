import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { can, fmtDateTime, fmtQty, type MoveType } from '@fca/core';
import { newId, useStore } from '../data/store';
import { exportMoves } from '../lib/exports';
import { t } from '../i18n';
import { Empty, MoveTypeLabel } from '../components/ui';

const TYPES: MoveType[] = ['in', 'out', 'adjust', 'count', 'created', 'edit', 'removed', 'void'];
const PAGE = 200;

export function Movements() {
  const { data, me, dispatch, toast } = useStore();
  const [params] = useSearchParams();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string>('all');
  const [person, setPerson] = useState('all');
  const [period, setPeriod] = useState(params.get('period') ?? '30');
  const [limit, setLimit] = useState(PAGE);

  const people = useMemo(() => [...new Set(data.moves.map((m) => m.user_name).filter(Boolean))].sort(), [data.moves]);

  const filtered = useMemo(() => {
    const since = period === 'all' ? 0 : Date.now() - Number(period) * 86_400_000;
    const q = query.toLowerCase().trim();
    return data.moves.filter(
      (m) =>
        Date.parse(m.at) >= since &&
        (type === 'all' || m.type === type) &&
        (person === 'all' || m.user_name === person) &&
        (!q || `${m.item_name} ${m.client} ${m.job} ${m.note}`.toLowerCase().includes(q)),
    );
  }, [data.moves, query, type, person, period]);

  const voidMove = (id: string) => {
    if (!confirm(t('moves.confirmVoid'))) return;
    if (dispatch({ kind: 'void', id: newId(), move_id: id })) toast('Movement reversed');
  };
  const canVoid = can(me?.role, 'void');

  return (
    <>
      <div className="page-head">
        <h1>{t('nav.movements')}</h1>
        <span className="spacer" />
        <button className="btn" onClick={() => exportMoves(filtered)}>{t('common.export')}</button>
      </div>
      <div className="card">
        <div className="card-head">
          <input className="search" type="search" placeholder={`${t('common.search')}: item, client, job…`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('common.search')} />
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 'auto' }} aria-label={t('common.type')}>
            <option value="all">All types</option>
            {TYPES.map((x) => <option key={x} value={x}>{t(`move.${x}`)}</option>)}
          </select>
          <select value={person} onChange={(e) => setPerson(e.target.value)} style={{ width: 'auto' }} aria-label={t('common.person')}>
            <option value="all">Everyone</option>
            {people.map((p) => <option key={p}>{p}</option>)}
          </select>
          <div className="chips" role="group" aria-label={t('common.period')}>
            {['7', '30', '90', 'all'].map((p) => (
              <button key={p} className={`chip${period === p ? ' on' : ''}`} onClick={() => setPeriod(p)} aria-pressed={period === p}>
                {p === 'all' ? t('common.all') : t('common.days', { n: p })}
              </button>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead>
                <tr>
                  <th>{t('common.when')}</th>
                  <th>{t('common.item')}</th>
                  <th>{t('common.type')}</th>
                  <th className="num">Change</th>
                  <th className="num">Balance</th>
                  <th>Client · job · reason</th>
                  <th>{t('common.by')}</th>
                  {canVoid && <th />}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((m) => (
                  <tr key={m.id} className={m.voided ? 'voided' : ''}>
                    <td className="first" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(m.at)}</td>
                    <td data-label={t('common.item')}>{m.item_name}</td>
                    <td data-label={t('common.type')}><MoveTypeLabel type={m.type} /></td>
                    <td className={`num ${m.delta < 0 ? 'neg' : m.delta > 0 ? 'pos' : ''}`} data-label="Change">
                      {m.delta ? `${m.delta > 0 ? '+' : ''}${fmtQty(m.delta)} ${m.unit}` : ''}
                      {m.metres ? <div className="muted small">{fmtQty(m.metres)} m</div> : null}
                    </td>
                    <td className="num" data-label="Balance">{m.balance != null ? fmtQty(m.balance) : ''}</td>
                    <td data-label="Details">{[m.client, m.job, m.note].filter(Boolean).join(' · ')}</td>
                    <td data-label={t('common.by')}>{m.user_name}</td>
                    {canVoid && (
                      <td className="actions">
                        {!m.voided && ['in', 'out', 'adjust', 'count'].includes(m.type) && (
                          <button className="btn small danger" onClick={() => voidMove(m.id)}>{t('moves.void')}</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > limit && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>Show more ({filtered.length - limit})</button>
          </div>
        )}
      </div>
    </>
  );
}
