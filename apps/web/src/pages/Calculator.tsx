import { useEffect, useMemo, useState } from 'react';
import { can, computeSqm, fmtDate, fmtQty, itemLabel, kigaliDay, matSize, sqmPct, takeLines, type BleedMode, type SqmItem, type SqmLocation } from '@fca/core';
import { useStore } from '../data/store';
import { t } from '../i18n';
import { Empty, Field } from '../components/ui';
import { SqmMaterialsEditor } from '../components/SqmMaterialsEditor';
import { TakeFromStock } from '../components/TakeFromStock';

// Job calculator: the SQM & Wastage Calculator, inside the Stock Room.
// The job being worked on is kept on this device (like the standalone app);
// "Take from stock" records the stock-outs for everyone.

const KEY = 'fca.sqm.job.v1';
const uid = () => Math.random().toString(36).slice(2, 9);

interface JobState {
  job: string;
  client: string;
  by: string;
  date: string;
  bleedMode: BleedMode;
  bleedCm: string;
  locations: SqmLocation[];
}

const blankItem = (mat: string): SqmItem => ({ id: uid(), name: '', mat, w: '', h: '', qty: 1 });
const blankJob = (by: string, mat: string): JobState => ({
  job: '',
  client: '',
  by,
  date: kigaliDay(),
  bleedMode: 'no',
  bleedCm: '',
  locations: [{ id: uid(), name: '', items: [blankItem(mat)] }],
});

const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export function Calculator() {
  const { data, me } = useStore();
  const materials = data.sqmMaterials;
  const firstMat = materials[0]?.id ?? '';
  const [job, setJob] = useState<JobState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (saved?.locations) return saved;
    } catch {
      /* start fresh */
    }
    return blankJob(me?.name ?? '', firstMat);
  });
  const [editMats, setEditMats] = useState(false);
  const [taking, setTaking] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(job));
    } catch {
      /* storage blocked */
    }
  }, [job]);

  const result = useMemo(() => computeSqm({ ...job, materials }), [job, materials]);
  const lines = useMemo(() => takeLines(result, data.items), [result, data.items]);
  const items = data.items;

  const set = <K extends keyof JobState>(k: K, v: JobState[K]) => setJob((j) => ({ ...j, [k]: v }));
  const setLoc = (id: string, fn: (l: SqmLocation) => SqmLocation) => setJob((j) => ({ ...j, locations: j.locations.map((l) => (l.id === id ? fn(l) : l)) }));
  const setItem = (locId: string, itemId: string, patch: Partial<SqmItem>) =>
    setLoc(locId, (l) => ({ ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }));

  const newJob = () => {
    if (confirm('Start a new job? The current one is cleared from this device.')) setJob(blankJob(job.by || me?.name || '', firstMat));
  };

  return (
    <>
      <div className="page-head no-print">
        <h1>{t('nav.calculator')}</h1>
        <span className="spacer" />
        <button className="btn" onClick={newJob}>New job</button>
        <button className="btn" onClick={() => window.print()} disabled={!result.T.items}>{t('common.print')} job sheet</button>
        {can(me?.role, 'stock') && (
          <button className="btn primary" onClick={() => setTaking(true)} disabled={!lines.length || result.errors > 0}>
            Take from stock
          </button>
        )}
      </div>

      <div className="sqm-grid">
        <div className="stack no-print">
          <section className="card">
            <div className="card-head"><h2>Job details</h2></div>
            <div className="fields">
              <Field label="Brand / job"><input value={job.job} onChange={(e) => set('job', e.target.value)} maxLength={120} /></Field>
              <Field label={t('common.client')}><input value={job.client} onChange={(e) => set('client', e.target.value)} maxLength={120} /></Field>
              <Field label="Prepared by"><input value={job.by} onChange={(e) => set('by', e.target.value)} maxLength={80} /></Field>
              <Field label="Date"><input type="date" value={job.date} onChange={(e) => set('date', e.target.value)} /></Field>
              <Field label="Add bleed to this job?">
                <select value={job.bleedMode} onChange={(e) => set('bleedMode', e.target.value as BleedMode)}>
                  <option value="no">No, sizes already include bleed</option>
                  <option value="yes">Yes, use each material's bleed</option>
                  <option value="custom">Yes, custom amount</option>
                </select>
              </Field>
              {job.bleedMode === 'custom' && (
                <Field label="Bleed per side (cm)">
                  <input type="number" min="0" step="0.5" inputMode="decimal" value={job.bleedCm} onChange={(e) => set('bleedCm', e.target.value)} placeholder="e.g. 5" />
                </Field>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Locations &amp; items</h2>
              <span className="muted small">sizes in cm</span>
            </div>
            <div className="stack">
              {job.locations.map((L, li) => (
                <div className="sqm-loc" key={L.id}>
                  <div className="row">
                    <input
                      className="sqm-loc-name"
                      value={L.name}
                      placeholder={`Location ${li + 1} (e.g. Kigali Heights shop)`}
                      aria-label={`Location ${li + 1} name`}
                      onChange={(e) => setLoc(L.id, (l) => ({ ...l, name: e.target.value }))}
                    />
                    {job.locations.length > 1 && (
                      <button className="btn small ghost danger" onClick={() => set('locations', job.locations.filter((l) => l.id !== L.id))} aria-label={`Remove location ${li + 1}`}>
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="sqm-items">
                    <div className="sqm-row sqm-head hide-sm" aria-hidden>
                      <span>Item</span><span>Material</span><span>Width</span><span>Height</span><span>Qty</span><span />
                    </div>
                    {L.items.map((it, ii) => (
                      <div className="sqm-row" key={it.id}>
                        <input value={it.name} placeholder={`Item ${ii + 1}`} aria-label="Item name" onChange={(e) => setItem(L.id, it.id, { name: e.target.value })} />
                        <select value={it.mat} aria-label="Material" onChange={(e) => setItem(L.id, it.id, { mat: e.target.value })}>
                          {!materials.some((m) => m.id === it.mat) && <option value={it.mat}>Pick a material</option>}
                          {materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({matSize(m)})</option>)}
                        </select>
                        <input type="number" inputMode="decimal" min="0" step="any" placeholder="W" aria-label="Width in cm" value={it.w} onChange={(e) => setItem(L.id, it.id, { w: e.target.value })} />
                        <input type="number" inputMode="decimal" min="0" step="any" placeholder="H" aria-label="Height in cm" value={it.h} onChange={(e) => setItem(L.id, it.id, { h: e.target.value })} />
                        <input type="number" inputMode="numeric" min="1" step="1" placeholder="Qty" aria-label="Quantity" value={it.qty} onChange={(e) => setItem(L.id, it.id, { qty: e.target.value })} />
                        <button
                          className="btn small ghost"
                          aria-label={`Remove item ${ii + 1}`}
                          onClick={() => setLoc(L.id, (l) => ({ ...l, items: l.items.length > 1 ? l.items.filter((x) => x.id !== it.id) : [blankItem(it.mat)] }))}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <button className="btn small" onClick={() => setLoc(L.id, (l) => ({ ...l, items: [...l.items, blankItem(l.items[l.items.length - 1]?.mat ?? firstMat)] }))}>
                    + Add item
                  </button>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => set('locations', [...job.locations, { id: uid(), name: '', items: [blankItem(firstMat)] }])}>+ Add location</button>
              <button className="btn ghost" style={{ whiteSpace: 'normal', textAlign: 'left' }} onClick={() => setEditMats(true)}>
                {can(me?.role, 'items') ? 'Material not in the list? Add or edit materials' : 'See materials'}
              </button>
            </div>
          </section>
        </div>

        <div className="stack sqm-report">
          <div className="print-only">
            <h2>{job.job || 'Print job'}{job.client ? ` · ${job.client}` : ''}</h2>
            <p className="small">{t('app.company')} · {job.by} · {job.date ? fmtDate(job.date) : ''}</p>
          </div>

          <div className="tiles sqm-tiles">
            <div className="tile"><div className="v">{f2(result.T.real)}</div><div className="l">Real SQM</div></div>
            <div className="tile low"><div className="v">{f2(result.T.waste)}</div><div className="l">Wastage SQM · {sqmPct(result.T.waste, result.T.total)}</div></div>
            <div className="tile"><div className="v">{f2(result.T.total)}</div><div className="l">Total SQM</div></div>
            <div className="tile"><div className="v">{f2(result.T.run)}</div><div className="l">Running metres · {result.T.pcs} pcs</div></div>
          </div>

          <section className="card">
            <div className="card-head">
              <h2>Stock to pull</h2>
              <span className="muted small">{job.bleedMode === 'no' ? 'no bleed added' : job.bleedMode === 'yes' ? "with each material's bleed" : `with ${+job.bleedCm || 0} cm bleed`}</span>
            </div>
            {lines.length === 0 ? (
              <Empty>Enter items with sizes and quantities to see what to pull.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="cards">
                  <thead>
                    <tr><th>Material</th><th className="num">Use</th><th>From stock</th><th className="num">In stock</th></tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const item = items.find((i) => i.id === l.item_id);
                      const short = item && item.qty < l.qty;
                      return (
                        <tr key={l.key}>
                          <td className="first">{l.label}</td>
                          <td className="num" data-label="Use">{l.useTxt}{item && item.unit === 'Rolls' ? <div className="muted small">{fmtQty(l.qty)} roll</div> : null}</td>
                          <td data-label="From stock">{item ? itemLabel(item) : <span className="muted">not linked</span>}</td>
                          <td className={`num ${short ? 'neg' : ''}`} data-label="In stock">{item ? `${fmtQty(item.qty)} ${item.unit}` : '–'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {result.locs.map(({ L, groups, rows, real, waste, total }, li) => {
            const errorsHere = rows.filter((x) => 'error' in x.r);
            if (!groups.length && !errorsHere.length) return null;
            return (
              <section className="card" key={L.id}>
                <div className="card-head">
                  <h2>{L.name || `Location ${li + 1}`}</h2>
                  <span className="spacer" />
                  <span className="muted small">{f2(real)} real · {f2(waste)} waste · {f2(total)} total SQM</span>
                </div>
                {errorsHere.map((x) => <p className="err" key={x.it.id}>{x.it.name || 'An item'}: {'error' in x.r ? x.r.error : ''}</p>)}
                <div className="table-wrap">
                  <table className="cards">
                    <thead>
                      <tr><th>Material</th><th>Items</th><th className="num">Real</th><th className="num">Waste</th><th className="num">Total</th><th>Use</th></tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <tr key={g.mat.id}>
                          <td className="first">{g.mat.name}<div className="muted small">{g.sizeTxt}</div></td>
                          <td data-label="Items">
                            {g.rows.map((x) => {
                              const P = g.panels?.[x.it.id];
                              return (
                                <div key={x.it.id} className="small">
                                  {x.it.name || 'Item'}: {x.r.w}×{x.r.h} cm × {x.r.q}
                                  {P ? <span className="muted"> · {P.n} panels of {Math.round(P.pw * 10) / 10}×{Math.round(P.along * 10) / 10}</span> : null}
                                </div>
                              );
                            })}
                          </td>
                          {g.error ? (
                            <td colSpan={4} className="err" data-label="Problem">{g.error}</td>
                          ) : (
                            <>
                              <td className="num" data-label="Real">{f2(g.real)}</td>
                              <td className="num" data-label="Waste">{f2(g.waste)}<div className="muted small">{sqmPct(g.waste, g.total)}</div></td>
                              <td className="num" data-label="Total">{f2(g.total)}</td>
                              <td data-label="Use">{g.useTxt}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}

          <p className="muted small">
            Real SQM is the finished size of each piece. Items of the same material in one location are laid out together on one roll or set of sheets; where a material
            comes in several roll widths, the width with the least wastage is used. Items wider than the roll are printed in panels; the panel overlap counts as wastage.
          </p>
        </div>
      </div>

      {editMats && <SqmMaterialsEditor onClose={() => setEditMats(false)} />}
      {taking && <TakeFromStock lines={lines} client={job.client} job={job.job} onClose={() => setTaking(false)} />}
    </>
  );
}
