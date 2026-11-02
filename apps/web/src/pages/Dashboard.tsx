import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { can, colourOf, fmtCover, fmtDate, fmtDateTime, fmtQty, inkByMachine, itemLabel, needsAttention, type InkColour } from '@fca/core';
import { backend, useStore } from '../data/store';
import { exportStock } from '../lib/exports';
import { Markdown } from '../lib/md';
import { t } from '../i18n';
import { Empty, MoveTypeLabel, StatusPill, useItemStats } from '../components/ui';
import { RecordMovement, RequestMaterial } from '../components/MovementForms';

const INK_FILL: Record<InkColour, string> = { cyan: '#00a6d6', magenta: '#d21359', yellow: '#f4c20d', black: '#222', white: '#e9e6ea' };

export function Dashboard() {
  const { data, me, toast, refresh } = useStore();
  const { items, stats } = useItemStats();
  const navigate = useNavigate();
  const [modal, setModal] = useState<'move' | 'request' | null>(null);
  const [writing, setWriting] = useState(false);

  const counts = useMemo(() => {
    let out = 0;
    let low = 0;
    stats.forEach((s) => (s.status === 'out' ? out++ : s.status === 'low' ? low++ : 0));
    const weekAgo = Date.now() - 7 * 86_400_000;
    const moves7 = data.moves.filter((m) => ['in', 'out', 'adjust', 'count'].includes(m.type) && Date.parse(m.at) > weekAgo).length;
    return { out, low, moves7 };
  }, [stats, data.moves]);

  const attention = useMemo(() => needsAttention(items).slice(0, 12), [items]);
  const fastest = useMemo(
    () =>
      items
        .map((item) => ({ item, s: stats.get(item.id)! }))
        .filter((x) => x.s.weeklyUse > 0)
        .sort((a, b) => b.s.weeklyUse - a.s.weeklyUse)
        .slice(0, 8),
    [items, stats],
  );
  const ink = useMemo(() => inkByMachine(items), [items]);
  const report = data.reports[0];

  const writeSummary = async () => {
    if (!me) return;
    setWriting(true);
    try {
      await backend.writeSummary(data, me);
      await refresh();
      toast('Summary written');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setWriting(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>{t('nav.dashboard')}</h1>
        <span className="spacer" />
        <button className="btn" onClick={() => exportStock(data.items)}>{t('common.export')}</button>
        {can(me?.role, 'request') && <button className="btn" onClick={() => setModal('request')}>{t('dash.request')}</button>}
        {can(me?.role, 'stock') && <button className="btn primary" onClick={() => setModal('move')}>{t('dash.record')}</button>}
      </div>

      <div className="tiles">
        <button className="tile" onClick={() => navigate('/stock')}>
          <div className="v">{items.length}</div>
          <div className="l">{t('dash.tracked')}</div>
        </button>
        <button className="tile out" onClick={() => navigate('/stock?status=out')}>
          <div className="v">{counts.out}</div>
          <div className="l">{t('dash.out')}</div>
        </button>
        <button className="tile low" onClick={() => navigate('/stock?status=low')}>
          <div className="v">{counts.low}</div>
          <div className="l">{t('dash.low')}</div>
        </button>
        <button className="tile" onClick={() => navigate('/movements?period=7')}>
          <div className="v">{counts.moves7}</div>
          <div className="l">{t('dash.moves7')}</div>
        </button>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <div className="card-head">
            <h2>{t('dash.summary')}</h2>
            {report && <span className="muted small">{fmtDate(report.date)} · {report.source === 'manual' ? 'written by hand' : 'automatic'}</span>}
            <span className="spacer" />
            {can(me?.role, 'summary') && (
              <button className="btn small" onClick={writeSummary} disabled={writing}>
                {writing ? 'Writing…' : t('dash.writeNow')}
              </button>
            )}
          </div>
          {report ? <Markdown text={report.text} /> : <Empty>{t('dash.noSummary')}</Empty>}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>{t('dash.attention')}</h2>
            <span className="badge">{needsAttention(items).length}</span>
          </div>
          {attention.length === 0 && <Empty>Everything is in good shape.</Empty>}
          <div className="list">
            {attention.map(({ item, stats: s }) => (
              <div className="list-row" key={item.id}>
                <div className="main">
                  <b>{itemLabel(item)}</b>
                  <span className="muted small">
                    {fmtQty(item.qty)} {item.unit} · {s.weeklyUse <= 0 ? 'no recent use' : item.qty <= 0 ? `used ${fmtQty(Math.round(s.weeklyUse * 10) / 10)}/wk` : `${fmtCover(s.cover)} cover`}
                    {s.suggestedOrder > 0 && ` · order ${s.suggestedOrder}`}
                  </span>
                </div>
                <StatusPill status={s.status} />
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>{t('dash.fastest')}</h2>
            <span className="muted small">average use per week</span>
          </div>
          {fastest.length === 0 && <Empty>No use recorded in the count history yet.</Empty>}
          <div className="list">
            {fastest.map(({ item, s }) => (
              <div className="list-row" key={item.id}>
                <div className="main">
                  <b>{itemLabel(item)}</b>
                  <div className="bar" aria-hidden>
                    <i style={{ width: `${Math.min(100, (s.weeklyUse / (fastest[0].s.weeklyUse || 1)) * 100)}%` }} />
                  </div>
                </div>
                <span className="num small">
                  {fmtQty(Math.round(s.weeklyUse * 10) / 10)} {item.unit}/wk
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>{t('dash.ink')}</h2>
            <span className="muted small">litres</span>
          </div>
          {ink.length === 0 && <Empty>No ink items yet. Name ink items with the machine, e.g. "SK-7 INK", size "CYAN".</Empty>}
          <div className="machines">
            {ink.map(({ machine, items: inks }) => (
              <div className="machine" key={machine.id}>
                <h3>{machine.label}</h3>
                <div className="bottles">
                  {inks.map((i) => {
                    const colour = colourOf(i);
                    const cap = Math.max(i.qty, i.min_level * 2, ...i.counts.map((c) => c.qty), 1);
                    const under = i.qty <= 0 || i.qty <= i.min_level;
                    const label = colour ?? (i.size || i.name.replace(/.*(SOLVENT|FLUSH).*/i, '$1')).toLowerCase();
                    return (
                      <div className={`bottle${under ? ' under' : ''}`} key={i.id} title={`${itemLabel(i)}: ${fmtQty(i.qty)} L`}>
                        <div className="glass">
                          <div className="fill" style={{ height: `${(i.qty / cap) * 100}%`, background: colour ? INK_FILL[colour] : '#9a8fa0' }} />
                        </div>
                        <b>{fmtQty(i.qty)}</b>
                        <span className="muted" style={{ textTransform: 'capitalize' }}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-head">
            <h2>{t('dash.latest')}</h2>
            <span className="spacer" />
            <button className="btn small" onClick={() => navigate('/movements')}>See all</button>
          </div>
          {data.moves.length === 0 && <Empty>No movements yet. Use “{t('dash.record')}” to log stock in and out.</Empty>}
          <div className="list">
            {data.moves.slice(0, 8).map((m) => (
              <div className="list-row" key={m.id} style={m.voided ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                <div className="main">
                  <b>{m.item_name}</b>
                  <span className="muted small">
                    <MoveTypeLabel type={m.type} /> · {fmtDateTime(m.at)} · {m.user_name}
                    {m.client && ` · ${m.client}`}
                  </span>
                </div>
                {m.delta !== 0 && (
                  <span className={`num ${m.delta < 0 ? 'neg' : 'pos'}`}>
                    {m.delta > 0 ? '+' : ''}
                    {fmtQty(m.delta)} {m.unit}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {modal === 'move' && <RecordMovement onClose={() => setModal(null)} />}
      {modal === 'request' && <RequestMaterial onClose={() => setModal(null)} />}
    </>
  );
}
