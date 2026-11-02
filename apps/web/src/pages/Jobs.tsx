import { useMemo, useState } from 'react';
import { fmtDate, fmtQty, round } from '@fca/core';
import { useStore } from '../data/store';
import { exportRows } from '../lib/excel';
import { t } from '../i18n';
import { Empty } from '../components/ui';

interface Group {
  key: string;
  client: string;
  job: string;
  last: string;
  uses: Map<string, { item: string; unit: string; qty: number; metres: number }>;
  count: number;
}

// Material used per client and job, from stock outs (approved requests
// create stock outs too). Reversed movements are left out.
export function Jobs() {
  const { data } = useStore();
  const [period, setPeriod] = useState('30');
  const [query, setQuery] = useState('');
  const [by, setBy] = useState<'client' | 'job'>('client');

  const groups = useMemo(() => {
    const since = period === 'all' ? 0 : Date.now() - Number(period) * 86_400_000;
    const q = query.toLowerCase().trim();
    const map = new Map<string, Group>();
    for (const m of data.moves) {
      if (m.type !== 'out' || m.voided || Date.parse(m.at) < since) continue;
      const client = m.client || 'No client';
      const job = m.job || '—';
      if (q && !`${client} ${job} ${m.item_name}`.toLowerCase().includes(q)) continue;
      const key = by === 'client' ? client.toLowerCase() : `${client.toLowerCase()}|${job.toLowerCase()}`;
      const g = map.get(key) ?? { key, client, job, last: m.at, uses: new Map(), count: 0 };
      g.count++;
      if (m.at > g.last) g.last = m.at;
      const u = g.uses.get(m.item_name) ?? { item: m.item_name, unit: m.unit, qty: 0, metres: 0 };
      u.qty += -m.delta;
      u.metres += m.metres ?? 0;
      g.uses.set(m.item_name, u);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [data.moves, period, query, by]);

  const exportIt = () =>
    exportRows('FCA jobs and clients', [
      {
        name: 'Material used',
        rows: groups.flatMap((g) =>
          [...g.uses.values()].map((u) => ({
            Client: g.client,
            ...(by === 'job' ? { Job: g.job } : {}),
            Item: u.item,
            Used: round(u.qty, 3),
            Unit: u.unit,
            Metres: u.metres ? round(u.metres, 2) : '',
            'Last used': fmtDate(g.last),
          })),
        ),
      },
    ]);

  return (
    <>
      <div className="page-head">
        <h1>{t('nav.jobs')}</h1>
        <span className="spacer" />
        <button className="btn" onClick={exportIt} disabled={!groups.length}>{t('common.export')}</button>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head" style={{ marginBottom: 0 }}>
          <input className="search" type="search" placeholder={`${t('common.search')}: client, job, item`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('common.search')} />
          <div className="seg">
            <button className={by === 'client' ? 'on' : ''} onClick={() => setBy('client')}>Per client</button>
            <button className={by === 'job' ? 'on' : ''} onClick={() => setBy('job')}>Per job</button>
          </div>
          <span className="spacer" />
          <div className="chips" role="group" aria-label={t('common.period')}>
            {['7', '30', '90', 'all'].map((p) => (
              <button key={p} className={`chip${period === p ? ' on' : ''}`} onClick={() => setPeriod(p)} aria-pressed={period === p}>
                {p === 'all' ? t('common.all') : t('common.days', { n: p })}
              </button>
            ))}
          </div>
        </div>
      </div>
      {groups.length === 0 && (
        <div className="card">
          <Empty>No stock outs with a client in this period. Fill in Client and Job when recording stock out.</Empty>
        </div>
      )}
      <div className="grid grid-2">
        {groups.map((g) => (
          <section className="card" key={g.key}>
            <div className="card-head">
              <h2>{g.client}</h2>
              {by === 'job' && <span className="muted">· {g.job}</span>}
              <span className="spacer" />
              <span className="muted small">
                {g.count} stock out{g.count === 1 ? '' : 's'} · last {fmtDate(g.last)}
              </span>
            </div>
            <div className="list">
              {[...g.uses.values()]
                .sort((a, b) => b.qty - a.qty)
                .map((u) => (
                  <div className="list-row" key={u.item}>
                    <div className="main"><b>{u.item}</b></div>
                    <span className="num">
                      {fmtQty(round(u.qty, 3))} {u.unit}
                      {u.metres ? <span className="muted small"> · {fmtQty(round(u.metres, 1))} m</span> : null}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
