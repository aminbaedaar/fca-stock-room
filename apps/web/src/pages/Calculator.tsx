import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  can,
  computeSqm,
  findMaterial,
  sqmDate,
  fmtQty,
  itemLabel,
  kigaliDay,
  materialFor,
  matSize,
  mTrim,
  parseItemsText,
  sqmBleedTxt,
  sqmF2 as f2,
  sqmNotes,
  sqmPanelTxt,
  sqmPct as pct,
  sqmUseShort,
  takeLines,
  type BleedMode,
  type ParsedLine,
  type SqmGroup,
  type SqmItem,
  type SqmJob,
  type SqmLocation,
  type SqmMaterial,
  type SqmResult,
} from '@fca/core';
import { newId, useStore } from '../data/store';
import { t } from '../i18n';
import { saveFile } from '../lib/save';
import { buildSqmPdf, sqmFileName } from '../lib/sqmPdf';
import { readArtwork, readReport } from '../lib/sqmFiles';
import { Empty, Field } from '../components/ui';
import { SqmMaterialsEditor } from '../components/SqmMaterialsEditor';
import { TakeFromStock } from '../components/TakeFromStock';

// Job calculator: the SQM & Wastage Calculator, inside the Stock Room.
// Everything the standalone app does (quick add, artwork sizes, report preview,
// PDF report and opening a report again), plus "Take from stock".
// The job being worked on is kept on this device; materials are shared.

const KEY = 'fca.sqm.job.v1';
const uid = () => Math.random().toString(36).slice(2, 9);

type CItem = SqmItem & { thumb?: string; note?: string; noteKind?: '' | 'warn' };
type CLoc = Omit<SqmLocation, 'items'> & { items: CItem[] };
interface JobState {
  job: string;
  client: string;
  by: string;
  date: string;
  bleedMode: BleedMode;
  bleedCm: string;
  locations: CLoc[];
  /** Materials added on this device (by quick add or an opened report) that are not in the shared list. */
  extraMats?: SqmMaterial[];
}
type Status = { msg: string; bad?: boolean; undo?: JobState } | null;
type OkLine = Extract<ParsedLine, { name: string }>;

const blankItem = (mat: string): CItem => ({ id: uid(), name: '', mat, w: '', h: '', qty: 1 });
const blankJob = (by: string, mat: string): JobState => ({
  job: '',
  client: '',
  by,
  date: kigaliDay(),
  bleedMode: 'no',
  bleedCm: '',
  locations: [{ id: uid(), name: '', items: [blankItem(mat)] }],
  extraMats: [],
});
const isBlank = (L: CLoc) => L.items.length === 1 && !L.items[0].name && !L.items[0].w && !L.items[0].h;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const okLines = (rows: ParsedLine[]) => rows.filter((r): r is OkLine => !('error' in r));

export function Calculator() {
  const { data, me, dispatch } = useStore();
  const canEditMats = can(me?.role, 'items');
  const seesStock = can(me?.role, 'view');
  const [job, setJob] = useState<JobState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (saved?.locations) return saved;
    } catch {
      /* start fresh */
    }
    return blankJob(me?.name ?? '', data.sqmMaterials[0]?.id ?? '');
  });
  // Shared materials first; this device's extra ones after (until they reach the shared list).
  const materials = useMemo(() => {
    const ids = new Set(data.sqmMaterials.map((m) => m.id));
    return [...data.sqmMaterials, ...(job.extraMats ?? []).filter((m) => !ids.has(m.id))];
  }, [data.sqmMaterials, job.extraMats]);
  const firstMat = materials[0]?.id ?? '';
  const [editMats, setEditMats] = useState(false);
  const [taking, setTaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [activeLoc, setActiveLoc] = useState(0);
  const [dragLoc, setDragLoc] = useState<string | null>(null);
  const reportInput = useRef<HTMLInputElement>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(job));
    } catch {
      /* storage blocked */
    }
  }, [job]);

  const sqmJob: SqmJob = useMemo(() => ({ ...job, materials }), [job, materials]);
  const result = useMemo(() => computeSqm(sqmJob), [sqmJob]);
  const lines = useMemo(() => takeLines(result, data.items), [result, data.items]);
  const items = data.items;
  const say = (msg: string, bad = false, undo?: JobState) => setStatus({ msg, bad, undo });

  const set = <K extends keyof JobState>(k: K, v: JobState[K]) => setJob((j) => ({ ...j, [k]: v }));
  const setLoc = (id: string, fn: (l: CLoc) => CLoc) => setJob((j) => ({ ...j, locations: j.locations.map((l) => (l.id === id ? fn(l) : l)) }));
  const setItem = (locId: string, itemId: string, patch: Partial<CItem>) =>
    setLoc(locId, (l) => ({ ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }));

  /**
   * The id of the named material, adding it (to `added`) when it is not in the list, with the
   * roll widths of a material of the same type.
   */
  const ensureMaterial = (name: string, added: SqmMaterial[]): { id: string; isNew: boolean } => {
    const { mat, isNew } = materialFor(name, [...materials, ...added], () => 'm' + uid());
    if (isNew) added.push(mat);
    return { id: mat.id, isNew };
  };
  // New materials: managers add them to the shared list; for others they stay with this job.
  const keepNewMaterials = (added: SqmMaterial[]) => {
    if (!added.length) return;
    setJob((j) => ({ ...j, extraMats: [...(j.extraMats ?? []), ...added] }));
    if (canEditMats) dispatch({ kind: 'saveSqmMaterials', id: newId(), materials: [...data.sqmMaterials, ...added] });
  };
  const newMatNote = (n: string) =>
    canEditMats ? `${n} was added to Materials. Check its roll widths.` : `${n} is not in the materials list yet, so it is used for this job only. Ask a manager to add it.`;

  // ---------- quick add ----------
  const addParsed = (locId: string, rows: OkLine[]) => {
    const L = job.locations.find((l) => l.id === locId);
    if (!L) return 0;
    const fallback = L.items[L.items.length - 1]?.mat || firstMat;
    const added: SqmMaterial[] = [];
    const newItems: CItem[] = rows.map((r) => {
      const notes: string[] = [];
      if (r.unitNote) notes.push(`Typed in, ${r.unitNote}. Check it.`);
      let mat = r.mat || fallback;
      if (r.newMat) {
        const e = ensureMaterial(r.newMat, added);
        mat = e.id;
        if (e.isNew) notes.push(newMatNote(r.newMat));
      }
      return { id: uid(), name: r.name, mat, w: r.w, h: r.h, qty: r.qty, note: notes.join(' '), noteKind: notes.length ? 'warn' : '' };
    });
    keepNewMaterials(added);
    setLoc(locId, (l) => ({ ...l, items: isBlank(l) ? newItems : [...l.items, ...newItems] }));
    return newItems.length;
  };
  const quickAdd = (L: CLoc) => {
    const rows = parseItemsText(drafts[L.id] ?? '', materials);
    const ok = okLines(rows),
      bad = rows.filter((r) => 'error' in r);
    if (!ok.length) {
      say(rows.length ? 'No sizes found. Write each item like: Banner, 2x3m - 12 pcs' : 'Type an item first, e.g. Banner, 2x3m - 12 pcs', true);
      return;
    }
    addParsed(L.id, ok);
    setDrafts((d) => ({ ...d, [L.id]: bad.map((r) => r.raw).join('\n') }));
    say(`Added ${plural(ok.length, 'item')} to ${L.name || 'this location'}.` + (bad.length ? ` ${plural(bad.length, 'line')} left in the box: no size found.` : ''), bad.length > 0);
  };

  // ---------- artwork files ----------
  const importFiles = async (files: File[], locId: string) => {
    const L = job.locations.find((l) => l.id === locId);
    if (!L) return;
    const fallback = L.items[L.items.length - 1]?.mat || firstMat;
    const added: CItem[] = [],
      problems: string[] = [];
    let fromFile = 0,
      unknown = 0;
    setBusy(true);
    for (const [i, file] of files.entries()) {
      say(`Reading ${file.name} (${i + 1} of ${files.length})…`);
      try {
        for (const a of await readArtwork(file)) {
          const fm = findMaterial(a.name, materials);
          const mat = fm && !fm.create ? fm.id : fallback;
          if (a.noSize) {
            unknown++;
            added.push({ id: uid(), name: a.name, mat, w: '', h: '', qty: 1, thumb: a.thumb, note: a.note, noteKind: 'warn' });
          } else {
            fromFile++;
            added.push({ id: uid(), name: a.name, mat, w: a.w!, h: a.h!, qty: 1, thumb: a.thumb, note: a.note });
          }
        }
      } catch (e) {
        problems.push(e instanceof Error ? e.message : `${file.name} could not be read.`);
      }
    }
    setBusy(false);
    if (added.length) setLoc(locId, (l) => ({ ...l, items: isBlank(l) ? added : [...l.items, ...added] }));
    const parts = [fromFile ? `${fromFile} sized from the file` : '', unknown ? `${unknown} need a size typed in` : ''].filter(Boolean);
    say(
      (added.length ? `Added ${plural(added.length, 'item')}: ${parts.join(', ')}. Set the material and quantity for each.` : '') + (problems.length ? ' ' + problems.join(' ') : ''),
      !added.length || unknown > 0 || problems.length > 0,
    );
  };

  // Paste anywhere on the page: text (or cells copied from Excel) or pictures go to the location last used.
  const pasteRef = useRef<(e: ClipboardEvent) => void>(() => {});
  pasteRef.current = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('input,textarea,select,.modal')) return;
    const L = job.locations[Math.min(activeLoc, job.locations.length - 1)];
    if (!L) return;
    if (text.trim()) {
      const ok = okLines(parseItemsText(text, materials));
      if (ok.length) {
        e.preventDefault();
        addParsed(L.id, ok);
        say(`Added ${plural(ok.length, 'item')} from the pasted text to ${L.name || 'this location'}.`);
        return;
      }
    }
    const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\/|pdf/.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    const named = files.map((f, i) =>
      f.name && !/^image\.\w+$/i.test(f.name) ? f : new File([f], `Pasted screenshot${files.length > 1 ? ' ' + (i + 1) : ''}.${f.type.split('/')[1] || 'png'}`, { type: f.type }),
    );
    void importFiles(named, L.id);
  };
  useEffect(() => {
    const h = (e: ClipboardEvent) => pasteRef.current(e);
    document.addEventListener('paste', h);
    return () => document.removeEventListener('paste', h);
  }, []);

  // ---------- material check: item names that say a different material ----------
  const mismatches = (L: CLoc) => {
    const out = new Map<string, number[]>();
    L.items.forEach((it, ii) => {
      const fm = findMaterial(it.name, materials);
      if (!fm) return;
      let key: string;
      if (fm.create) {
        const ex = materials.find((m) => m.name.toLowerCase() === fm.name.toLowerCase());
        key = ex ? ex.id : 'new:' + fm.name;
      } else key = fm.id;
      if (key === it.mat) return;
      out.set(key, [...(out.get(key) ?? []), ii]);
    });
    return out;
  };
  const fixMaterial = (L: CLoc, key: string, iis: number[]) => {
    const added: SqmMaterial[] = [];
    const isNew = key.startsWith('new:');
    const id = isNew ? ensureMaterial(key.slice(4), added).id : key;
    const name = isNew ? key.slice(4) : (materials.find((m) => m.id === id)?.name ?? '');
    keepNewMaterials(added);
    setLoc(L.id, (l) => ({ ...l, items: l.items.map((it, ii) => (iis.includes(ii) ? { ...it, mat: id } : it)) }));
    say(`Moved ${plural(iis.length, 'item')} to ${name}.` + (added.length ? ' ' + newMatNote(name) : ''));
  };

  // ---------- job, report ----------
  const newJob = () => {
    if (!confirm('Start a new job? The current one is cleared from this device.')) return;
    setJob(blankJob(job.by || me?.name || '', firstMat));
    setDrafts({});
    say('Started a new job. The materials list was kept.');
  };
  const downloadPdf = async () => {
    if (!result.T.items) {
      say('Add at least one item with a size and quantity first.', true);
      return;
    }
    setBusy(true);
    try {
      const name = sqmFileName(job);
      await saveFile(name, await buildSqmPdf(sqmJob));
      say(`Saved ${name}.`);
    } catch (e) {
      say(`The PDF could not be made: ${e instanceof Error ? e.message : e}`, true);
    } finally {
      setBusy(false);
    }
  };
  const openReport = async (file: File) => {
    say(`Opening ${file.name}…`);
    setBusy(true);
    let rj: Awaited<ReturnType<typeof readReport>> = null;
    try {
      rj = await readReport(file);
    } catch {
      rj = null;
    }
    setBusy(false);
    if (!rj || !rj.locations?.some((L) => L.items?.length)) {
      say(`${file.name} could not be opened. Choose a PDF report made by the job calculator or the SQM & Wastage Calculator.`, true);
      return;
    }
    // Match the report's materials to the list by name; add any that are missing.
    const added: SqmMaterial[] = [];
    const idFor: Record<string, string> = {};
    (rj.materials || []).forEach((m) => {
      const have = [...materials, ...added].find((x) => x.name.toLowerCase() === String(m.name || '').toLowerCase());
      if (have) idFor[m.id] = have.id;
      else {
        const nm = { ...m, id: 'm' + uid() };
        added.push(nm);
        idFor[m.id] = nm.id;
      }
    });
    const matOf = (x: { mat?: string; matName?: string; rollW?: number | null }) => {
      if (x.mat && idFor[x.mat]) return idFor[x.mat];
      if (x.matName) {
        const e = ensureMaterial(x.matName, added);
        const nm = added[added.length - 1];
        if (e.isNew && x.rollW && nm.kind === 'roll') Object.assign(nm, { width: x.rollW, widths: String(x.rollW) });
        return e.id;
      }
      return firstMat;
    };
    const undo = job;
    const locations = rj.locations.map((L) => ({
      id: uid(),
      name: L.name || '',
      items: L.items.map((x) => ({ id: uid(), name: x.name || '', mat: matOf(x), w: x.w, h: x.h, qty: x.qty || 1 })),
    }));
    keepNewMaterials(added);
    setJob((j) => ({
      ...j,
      job: rj.job || '',
      client: rj.client || '',
      by: rj.by || j.by,
      date: rj.date || j.date,
      bleedMode: rj.bleedMode || 'no',
      bleedCm: String(rj.bleedCm ?? ''),
      locations,
    }));
    setDrafts({});
    const n = locations.reduce((a, L) => a + L.items.length, 0);
    say(`Opened ${file.name}: ${plural(n, 'item')} in ${plural(locations.length, 'location')}.`, false, undo);
  };

  const onDrop = (e: DragEvent, locId: string) => {
    e.preventDefault();
    setDragLoc(null);
    if (e.dataTransfer.files.length) void importFiles([...e.dataTransfer.files], locId);
  };

  return (
    <>
      <div className="page-head no-print">
        <h1>{t('nav.calculator')}</h1>
        <span className="spacer" />
        <button className="btn" onClick={newJob}>New job</button>
        <button className="btn" onClick={() => reportInput.current?.click()} disabled={busy}>Open PDF report</button>
        <input
          ref={reportInput}
          type="file"
          accept=".pdf,application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void openReport(f);
          }}
        />
        <button className="btn primary" onClick={downloadPdf} disabled={busy || !result.T.items}>Download PDF report</button>
        {can(me?.role, 'stock') && (
          <button className="btn primary" onClick={() => setTaking(true)} disabled={!lines.length || result.errors > 0}>
            Take from stock
          </button>
        )}
      </div>
      {status && (
        <p className={`sqm-status no-print ${status.bad ? 'bad' : ''}`} role="status">
          {status.msg}
          {status.undo && (
            <button
              className="btn small ghost"
              onClick={() => {
                setJob(status.undo!);
                say('Back to the job you had before.');
              }}
            >
              Undo
            </button>
          )}
        </p>
      )}

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
              {job.locations.map((L, li) => {
                const l = result.locs[li];
                const fixes = [...mismatches(L)];
                const draft = drafts[L.id] ?? '';
                return (
                  <div
                    className={`sqm-loc ${dragLoc === L.id ? 'drag' : ''}`}
                    key={L.id}
                    onFocus={() => setActiveLoc(li)}
                    onPointerDown={() => setActiveLoc(li)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragLoc(L.id);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragLoc(null);
                    }}
                    onDrop={(e) => onDrop(e, L.id)}
                  >
                    <div className="row">
                      <input
                        className="sqm-loc-name"
                        value={L.name}
                        placeholder={`Location ${li + 1} (e.g. Kigali Heights shop)`}
                        aria-label={`Location ${li + 1} name`}
                        onChange={(e) => setLoc(L.id, (x) => ({ ...x, name: e.target.value }))}
                      />
                      {job.locations.length > 1 && (
                        <button className="btn small ghost danger" onClick={() => set('locations', job.locations.filter((x) => x.id !== L.id))} aria-label={`Remove location ${li + 1}`}>
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="sqm-items">
                      <div className="sqm-row sqm-head hide-sm" aria-hidden>
                        <span>Item</span><span>Material</span><span>Width</span><span>Height</span><span>Qty</span><span className="num">Real SQM</span><span />
                      </div>
                      {L.items.map((it, ii) => {
                        const out = rowOut(l, ii);
                        const clearNote = it.note ? { note: '', noteKind: '' as const } : {};
                        return (
                          <div className="sqm-item" key={it.id}>
                            <div className="sqm-row">
                              <div className="sqm-name">
                                {it.thumb && <img className="sqm-thumb" src={it.thumb} alt="" />}
                                <input value={it.name} placeholder={`Item ${ii + 1}, e.g. Window sticker`} aria-label="Item name" onChange={(e) => setItem(L.id, it.id, { name: e.target.value })} />
                              </div>
                              <select value={it.mat} aria-label="Material" onChange={(e) => setItem(L.id, it.id, { mat: e.target.value })}>
                                {!materials.some((m) => m.id === it.mat) && <option value={it.mat}>Pick a material</option>}
                                {materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({matSize(m)})</option>)}
                              </select>
                              <input type="number" inputMode="decimal" min="0" step="any" placeholder="W" aria-label="Width in cm" value={it.w} onChange={(e) => setItem(L.id, it.id, { w: e.target.value, ...clearNote })} />
                              <input type="number" inputMode="decimal" min="0" step="any" placeholder="H" aria-label="Height in cm" value={it.h} onChange={(e) => setItem(L.id, it.id, { h: e.target.value, ...clearNote })} />
                              <input type="number" inputMode="numeric" min="1" step="1" placeholder="Qty" aria-label="Quantity" value={it.qty} onChange={(e) => setItem(L.id, it.id, { qty: e.target.value })} />
                              <span className="num sqm-real" title="Real SQM">{out.real}</span>
                              <button
                                className="btn small ghost"
                                aria-label={`Remove item ${ii + 1}`}
                                onClick={() => setLoc(L.id, (x) => ({ ...x, items: x.items.length > 1 ? x.items.filter((y) => y.id !== it.id) : [blankItem(it.mat)] }))}
                              >
                                ✕
                              </button>
                            </div>
                            {(out.hint || it.note) && (
                              <div className="sqm-hints">
                                {out.hint && <div className={out.bad ? 'err' : 'sqm-hint'}>{out.hint}</div>}
                                {it.note && <div className={`sqm-note ${it.noteKind === 'warn' ? 'warn' : ''}`}>{it.note}</div>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="sqm-qa">
                      <label className="muted small" htmlFor={`qa-${L.id}`}>Quick add: type or paste items (Enter adds them)</label>
                      <textarea
                        id={`qa-${L.id}`}
                        rows={2}
                        value={draft}
                        placeholder="One item per line, e.g.  Banner, 2x3m - 12 pcs   or paste cells from Excel"
                        onChange={(e) => setDrafts((d) => ({ ...d, [L.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            quickAdd(L);
                          }
                        }}
                      />
                      {draft.trim() && (
                        <div className="sqm-qa-row">
                          <div className="sqm-qa-preview">
                            {parseItemsText(draft, materials).map((r, i) =>
                              'error' in r ? (
                                <div key={i} className="qa-bad">✕ {r.raw.replace(/\t+/g, ' ').trim()}: {r.error}</div>
                              ) : (
                                <div key={i} className="qa-ok">
                                  ✓ {r.name} · {r.w} × {r.h} cm · {r.qty} pcs ·{' '}
                                  {r.newMat ? <span className="qa-note">{r.newMat} (new material, will be added)</span> : materials.find((m) => m.id === r.mat)?.name || 'material: last used'}
                                  {r.unitNote && <span className="qa-note"> ({r.unitNote})</span>}
                                </div>
                              ),
                            )}
                          </div>
                          <button className="btn small primary" onClick={() => quickAdd(L)}>Add items</button>
                        </div>
                      )}
                    </div>

                    <div className="row">
                      <button className="btn small" onClick={() => setLoc(L.id, (x) => ({ ...x, items: [...x.items, blankItem(x.items[x.items.length - 1]?.mat ?? firstMat)] }))}>
                        + Add item
                      </button>
                      <button className="btn small" onClick={() => fileInputs.current[L.id]?.click()} disabled={busy}>Import pictures…</button>
                      <input
                        ref={(el) => {
                          fileInputs.current[L.id] = el;
                        }}
                        type="file"
                        multiple
                        hidden
                        accept="image/*,.pdf,application/pdf,.svg,.ai,.eps,application/postscript,application/illustrator"
                        onChange={(e) => {
                          const fs = [...(e.target.files ?? [])];
                          e.target.value = '';
                          if (fs.length) void importFiles(fs, L.id);
                        }}
                      />
                      <span className="muted small hide-sm">or drop artwork here (PDF, AI, EPS, SVG, JPG, PNG)</span>
                    </div>

                    {fixes.map(([key, iis]) => {
                      const isNew = key.startsWith('new:');
                      const target = isNew ? key.slice(4) : (materials.find((m) => m.id === key)?.name ?? '?');
                      const now = [...new Set(iis.map((ii) => materials.find((m) => m.id === L.items[ii].mat)?.name ?? '?'))].join(', ');
                      return (
                        <div className="sqm-mu fix" key={key}>
                          <span>
                            {plural(iis.length, 'item')} named <b>{target}</b> {iis.length > 1 ? 'are' : 'is'} set to {now}.
                          </span>
                          <button className="btn small" onClick={() => fixMaterial(L, key, iis)}>
                            Move {iis.length > 1 ? 'them' : 'it'} to {target}
                            {isNew ? ' (new material)' : ''}
                          </button>
                        </div>
                      );
                    })}
                    {l && l.groups.length > 0 && (
                      <div className="sqm-use">
                        <div className="muted small">Material use</div>
                        {l.groups.map((g) =>
                          g.error ? (
                            <div className="sqm-mu bad" key={g.mat.id}>
                              <b>{g.mat.name}</b> · {g.error}
                            </div>
                          ) : (
                            <div className="sqm-mu" key={g.mat.id}>
                              <b>{g.mat.name}</b> · {plural(g.rows.length, 'item')}, {g.pcs} pcs · {g.useTxt}
                              <span className="sqm-mu-n">
                                real {f2(g.real)} · total {f2(g.total)} · waste {f2(g.waste)} ({pct(g.waste, g.total)})
                              </span>
                              {g.tried && g.tried.length > 1 && (
                                <span className="sqm-mu-alt">Widths tried: {g.tried.map((x) => `${mTrim(x.W)} m → ${f2(x.total)} SQM`).join(', ')}</span>
                              )}
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => set('locations', [...job.locations, { id: uid(), name: '', items: [blankItem(firstMat)] }])}>+ Add location</button>
              <button className="btn ghost" style={{ whiteSpace: 'normal', textAlign: 'left' }} onClick={() => setEditMats(true)}>
                {canEditMats ? 'Material not in the list? Add or edit materials' : 'See materials'}
              </button>
            </div>
          </section>
        </div>

        <div className="stack sqm-report">
          <section className="card no-print">
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
                    <tr><th>Material</th><th className="num">Use</th>{seesStock && <><th>From stock</th><th className="num">In stock</th></>}</tr>
                  </thead>
                  <tbody>
                    {lines.map((ln) => {
                      const item = items.find((i) => i.id === ln.item_id);
                      const short = item && item.qty < ln.qty;
                      return (
                        <tr key={ln.key}>
                          <td className="first">{ln.label}</td>
                          <td className="num" data-label="Use">{ln.useTxt}{item && item.unit === 'Rolls' ? <div className="muted small">{fmtQty(ln.qty)} roll</div> : null}</td>
                          {seesStock && (
                            <>
                              <td data-label="From stock">{item ? itemLabel(item) : <span className="muted">not linked</span>}</td>
                              <td className={`num ${short ? 'neg' : ''}`} data-label="In stock">{item ? `${fmtQty(item.qty)} ${item.unit}` : '–'}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="muted small no-print">Report preview · A4 (as in the PDF)</div>
          <ReportPreview job={sqmJob} result={result} />
        </div>
      </div>

      {editMats && <SqmMaterialsEditor onClose={() => setEditMats(false)} />}
      {taking && <TakeFromStock lines={lines} client={job.client} job={job.job} onClose={() => setTaking(false)} />}
    </>
  );
}

/** What to show beside an item: its real SQM, and the roll it shares or the panels it needs. */
function rowOut(l: SqmResult['locs'][number] | undefined, ii: number): { real: string; hint: string; bad?: boolean } {
  const x = l?.rows[ii];
  if (!l || !x) return { hint: '', real: '' };
  if ('error' in x.r) return { hint: x.r.error, bad: true, real: '' };
  if ('empty' in x.r) return { hint: '', real: '' };
  const real = f2(x.r.real);
  const g = l.groups.find((g) => g.rows.some((r) => r.it.id === x.it.id));
  if (!g) return { hint: '', real };
  if (g.error) return { hint: g.error, bad: true, real };
  const others = g.rows.length - 1,
    p = sqmPanelTxt(g, x.it.id);
  return { real, hint: [p, others ? `shares ${g.sizeTxt} with ${plural(others, 'other item')}` : `on ${g.sizeTxt}`].filter(Boolean).join(' · ') };
}

/** The two A4 pages of the PDF report, as they will come out. */
function ReportPreview({ job, result: C }: { job: SqmJob; result: SqmResult }) {
  const { T } = C;
  const dateTxt = sqmDate(job.date);
  const locNames = job.locations.map((L) => L.name).filter(Boolean).join(', ') || '–';
  const foot = (n: number) => (
    <div className="foot">
      <span><b>{job.by}</b> · {dateTxt}</span>
      <span className="pg">Page {n} of 2</span>
    </div>
  );
  const logo = (sm?: boolean) => (
    <span className={`rlogo ${sm ? 'sm' : ''}`}>
      <img className="m" src="/sqm-mark.png" alt="" />
      <img className="w" src="/sqm-wordmark.png" alt="First Choice Africa Limited" />
    </span>
  );
  return (
    <div className="sqm-proof">
      <div className="sheet">
        <div className="rhead">
          {logo()}
          <div className="rtitle"><b>SQM &amp; Wastage Report</b><span>{dateTxt}</span></div>
        </div>
        <div className="rband" />
        <dl className="meta">
          <dt>Brand / job</dt><dd>{job.job || '–'}</dd>
          <dt>Client</dt><dd>{job.client || '–'}</dd>
          <dt>Locations</dt><dd>{locNames}</dd>
          <dt>Prepared by</dt><dd>{job.by || '–'}</dd>
          <dt>Date</dt><dd>{dateTxt}</dd>
          <dt>Bleed</dt><dd>{sqmBleedTxt(job)}</dd>
        </dl>
        <h4>Summary</h4>
        <div className="rtiles">
          <div className="rtile"><div className="k">REAL SQM</div><div className="v">{f2(T.real)}</div></div>
          <div className="rtile"><div className="k">WASTAGE SQM</div><div className="v">{f2(T.waste)}</div></div>
          <div className="rtile"><div className="k">TOTAL SQM</div><div className="v">{f2(T.total)}</div></div>
          <div className="rtile"><div className="k">RUNNING MTR</div><div className="v">{f2(T.run)}</div></div>
          <div className="rtile rate"><div className="k">WASTAGE RATE</div><div className="v">{pct(T.waste, T.total)}</div></div>
        </div>
        <h4>Summary by item</h4>
        <table>
          <thead>
            <tr><th>#</th><th>Item</th><th>Size</th><th className="n">Qty</th><th className="n">Running m / sheets</th><th className="n">Real SQM</th><th className="n">Wastage SQM</th><th className="n">Total SQM</th><th className="n">Waste %</th></tr>
          </thead>
          {C.locs.map((l) => {
            const errs = l.rows.filter((x) => 'error' in x.r);
            let n = errs.length;
            return (
              <tbody key={l.L.id}>
                <tr className="grp"><td colSpan={9}>{l.L.name || 'Unnamed location'}</td></tr>
                {errs.map((x, i) => (
                  <tr key={x.it.id}><td>{i + 1}</td><td>{x.it.name || '–'}</td><td colSpan={7} className="bad">{'error' in x.r ? x.r.error : ''}</td></tr>
                ))}
                {l.groups.map((g) => {
                  const start = n;
                  n += g.rows.length;
                  return <GroupRows key={g.mat.id} g={g} start={start} />;
                })}
                <tr className="sub">
                  <td /><td colSpan={2}>Subtotal {l.L.name}</td><td className="n">{l.pcs}</td><td className="n">{f2(l.run)}</td><td className="n">{f2(l.real)}</td>
                  <td className="n">{f2(l.waste)}</td><td className="n">{f2(l.total)}</td><td className="n">{pct(l.waste, l.total)}</td>
                </tr>
              </tbody>
            );
          })}
          <tbody>
            <tr className="tot">
              <td /><td colSpan={2}>Job total · {plural(T.items, 'item')}</td><td className="n">{T.pcs}</td><td className="n">{f2(T.run)}</td><td className="n">{f2(T.real)}</td>
              <td className="n">{f2(T.waste)}</td><td className="n">{f2(T.total)}</td><td className="n">{pct(T.waste, T.total)}</td>
            </tr>
          </tbody>
        </table>
        <h4>Notes</h4>
        <p className="notes">{sqmNotes(job)}</p>
        {foot(1)}
      </div>
      <div className="sheet">
        <div className="runhead">{logo(true)}<span>SQM &amp; Wastage Report</span></div>
        <h4>Material to pull from stock</h4>
        <table>
          <thead>
            <tr><th>Location</th><th>Items</th><th className="n">Pcs</th><th className="n">Running m / sheets</th><th className="n">Real SQM</th><th className="n">Wastage SQM</th><th className="n">Total SQM</th><th className="n">Waste %</th></tr>
          </thead>
          {C.stockGroups.map((s) => (
            <tbody key={s.key}>
              <tr className="grp"><td colSpan={8}>{s.mat.name} · {s.sizeTxt}</td></tr>
              {s.entries.map((e, i) => (
                <tr key={i}>
                  <td>{e.loc || '–'}</td><td>{e.g.rows.map((x) => x.it.name || '–').join(', ')}</td><td className="n">{e.g.pcs}</td><td className="n">{sqmUseShort(s.mat, e.g.use)}</td>
                  <td className="n">{f2(e.g.real)}</td><td className="n">{f2(e.g.waste)}</td><td className="n">{f2(e.g.total)}</td><td className="n">{pct(e.g.waste, e.g.total)}</td>
                </tr>
              ))}
              <tr className="sub">
                <td colSpan={2}>Total {s.mat.name} ({s.sizeTxt})</td><td className="n">{s.pcs}</td><td className="n">{s.useTxt}</td><td className="n">{f2(s.real)}</td>
                <td className="n">{f2(s.waste)}</td><td className="n">{f2(s.total)}</td><td className="n">{pct(s.waste, s.total)}</td>
              </tr>
            </tbody>
          ))}
        </table>
        {foot(2)}
      </div>
    </div>
  );
}

function GroupRows({ g, start }: { g: SqmGroup; start: number }) {
  return (
    <>
      {g.rows.map((x, i) => {
        const p = sqmPanelTxt(g, x.it.id);
        return (
          <tr key={x.it.id}>
            <td>{start + i + 1}</td>
            <td>{x.it.name || '–'}{p && <div className="small">{p}</div>}</td>
            <td>{x.it.w} × {x.it.h} cm</td>
            <td className="n">{x.r.q}</td>
            <td /><td className="n">{f2(x.r.real)}</td><td /><td /><td />
          </tr>
        );
      })}
      {g.error ? (
        <tr className="mat"><td /><td colSpan={8} className="bad">{g.mat.name}: {g.error}</td></tr>
      ) : (
        <tr className="mat">
          <td /><td colSpan={2}>{g.mat.name} · {g.useTxt}</td><td className="n">{g.pcs}</td><td className="n">{g.mat.kind === 'roll' ? f2(g.run) : g.useTxt}</td>
          <td className="n">{f2(g.real)}</td><td className="n">{f2(g.waste)}</td><td className="n">{f2(g.total)}</td><td className="n">{pct(g.waste, g.total)}</td>
        </tr>
      )}
    </>
  );
}
