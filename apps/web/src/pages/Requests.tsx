import { useState } from 'react';
import { can, fmtDateTime, fmtQty, type RequestStatus } from '@fca/core';
import { newId, useStore } from '../data/store';
import { t } from '../i18n';
import { Empty } from '../components/ui';
import { RequestMaterial } from '../components/MovementForms';

export function Requests() {
  const { data, me, dispatch, toast } = useStore();
  const [filter, setFilter] = useState<RequestStatus | 'all'>('pending');
  const [creating, setCreating] = useState(false);
  const list = data.requests.filter((r) => filter === 'all' || r.status === filter);
  const canApprove = can(me?.role, 'approve');

  const decide = (id: string, approve: boolean) => {
    if (dispatch({ kind: 'decide', id: newId(), request_id: id, approve })) toast(approve ? 'Approved: stock out recorded' : 'Request rejected');
  };

  return (
    <>
      <div className="page-head">
        <h1>{t('nav.requests')}</h1>
        <span className="spacer" />
        {can(me?.role, 'request') && <button className="btn primary" onClick={() => setCreating(true)}>{t('req.new')}</button>}
      </div>
      <div className="card">
        <div className="card-head">
          <div className="chips" role="group" aria-label={t('common.status')}>
            {(['pending', 'approved', 'rejected', 'all'] as const).map((s) => (
              <button key={s} className={`chip${filter === s ? ' on' : ''}`} onClick={() => setFilter(s)} aria-pressed={filter === s}>
                {s === 'all' ? t('common.all') : t(`req.${s}`)}
                {s === 'pending' && ` (${data.requests.filter((r) => r.status === 'pending').length})`}
              </button>
            ))}
          </div>
        </div>
        {list.length === 0 ? (
          <Empty>{filter === 'pending' ? 'No requests waiting.' : undefined}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead>
                <tr>
                  <th>{t('common.when')}</th>
                  <th>{t('common.item')}</th>
                  <th className="num">{t('common.qty')}</th>
                  <th>Client · job · note</th>
                  <th>Requested by</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const item = data.items.find((i) => i.id === r.item_id);
                  const short = item && item.qty < r.qty;
                  return (
                    <tr key={r.id}>
                      <td className="first">{fmtDateTime(r.created_at)}</td>
                      <td data-label={t('common.item')}>
                        {r.item_name}
                        {item && r.status === 'pending' && (
                          <div className={`small ${short ? 'neg' : 'muted'}`}>
                            {fmtQty(item.qty)} {item.unit} in stock
                          </div>
                        )}
                      </td>
                      <td className="num" data-label={t('common.qty')}>{fmtQty(r.qty)} {r.unit}</td>
                      <td data-label="Details">{[r.client, r.job, r.note].filter(Boolean).join(' · ')}</td>
                      <td data-label="Requested by">{r.requested_by_name}</td>
                      <td data-label={t('common.status')}>
                        <span className={`pill ${r.status}`}>{t(`req.${r.status}`)}</span>
                        {r.decided_by_name && <div className="muted small">{r.decided_by_name}</div>}
                      </td>
                      <td className="actions">
                        {canApprove && r.status === 'pending' && (
                          <>
                            <button className="btn small primary" onClick={() => decide(r.id, true)} disabled={short}>{t('req.approve')}</button>{' '}
                            <button className="btn small" onClick={() => decide(r.id, false)}>{t('req.reject')}</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <RequestMaterial onClose={() => setCreating(false)} />}
    </>
  );
}
