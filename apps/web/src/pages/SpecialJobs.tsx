import { useEffect, useMemo, useState, type ClipboardEvent } from 'react';
import { can, fmtDateTime, kigaliDay, SPECIAL_KINDS, SPECIAL_STAGES, specialSqm, sqmDate, type SpecialJob, type SpecialKind, type SpecialStage } from '@fca/core';
import { backend, newId, useStore } from '../data/store';
import type { SpecialFields } from '../data/types';
import { Empty, Field, Modal } from '../components/ui';
import { saveFile } from '../lib/save';
import { shrinkPhoto } from '../lib/photo';
import { addDaysIso, buildSpecialPdf, sizesText, specialPdfName, weekStart } from '../lib/specialPdf';

type Filter = 'pending' | 'notInvoiced' | 'invoiced' | 'rejected' | 'deleted' | 'all';
type LineDraft = { material: string; w: string; h: string; qty: string };

const STATUS_LABEL = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected' } as const;
const STAGE_KEYS = Object.keys(SPECIAL_STAGES) as SpecialStage[];
const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

// Complimentary jobs and jobs without a sales order. Everyone enters their own;
// the Boss or Admin approves them, ticks Invoiced, and prints the weekly PDF.
export function SpecialJobs({ kind }: { kind: SpecialKind }) {
  const { data, me, dispatch, toast } = useStore();
  const boss = can(me?.role, 'approve_special');
  const [filter, setFilter] = useState<Filter>(boss ? 'pending' : 'all');
  const [editing, setEditing] = useState<SpecialJob | 'new' | null>(null);
  const [staging, setStaging] = useState<SpecialJob | null>(null);
  const [rejecting, setRejecting] = useState<SpecialJob | null>(null);
  const [invoicing, setInvoicing] = useState<SpecialJob | null>(null);
  const [week, setWeek] = useState(() => weekStart(kigaliDay()));
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SpecialJob | null>(null);

  // People see their own jobs; the Boss and Admin see everyone's (the database does the same).
  const mine = useMemo(() => data.specialJobs.filter((j) => j.kind === kind && (boss || j.created_by === me?.user_id)), [data.specialJobs, kind, boss, me?.user_id]);
  const count = (f: Filter) => mine.filter((j) => match(j, f)).length;
  const list = mine.filter((j) => match(j, filter));
  const weekJobs = mine.filter((j) => j.job_date >= week && j.job_date <= addDaysIso(week, 6));

  if (!me) return null;

  const approve = (j: SpecialJob) => {
    if (dispatch({ kind: 'decideSpecial', id: newId(), job_id: j.id, approve: true, note: '' })) toast(`Approved: ${j.client}`);
  };
  const pdf = async () => {
    setBusy(true);
    try {
      const blob = await buildSpecialPdf(weekJobs, week, me.name || me.email, (path) => backend.photoUrl(path), kind);
      await saveFile(specialPdfName(week, kind), blob);
    } catch (e) {
      toast(`Could not make the PDF: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>{kind === 'complimentary' ? 'Complimentary jobs' : 'No sales order jobs'}</h1>
        <span className="spacer" />
        {can(me.role, 'special') && (
          <button className="btn primary" onClick={() => setEditing('new')}>
            + New job
          </button>
        )}
      </div>

      {boss && (
        <div className="card stack" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h2>Weekly PDF for checking invoices</h2>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn ghost small" onClick={() => setWeek(addDaysIso(week, -7))} aria-label="Previous week">
              ‹
            </button>
            <input type="date" value={week} onChange={(e) => e.target.value && setWeek(weekStart(e.target.value))} aria-label="Any day in the week" style={{ width: 'auto' }} />
            <button className="btn ghost small" onClick={() => setWeek(addDaysIso(week, 7))} aria-label="Next week">
              ›
            </button>
            <span className="muted small">
              {sqmDate(week)} to {sqmDate(addDaysIso(week, 6))} · {weekJobs.length} jobs ·{' '}
              <b style={{ color: 'var(--out)' }}>{weekJobs.filter((j) => j.status === 'approved' && !j.invoiced).length} not invoiced</b>
            </span>
            <span className="spacer" />
            <button className="btn primary" onClick={pdf} disabled={busy}>
              {busy ? 'Making PDF…' : 'Download weekly PDF'}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div className="chips" role="group" aria-label="Show">
            {(
              [
                ['pending', 'Waiting for approval'],
                ['notInvoiced', 'Approved, not invoiced'],
                ['invoiced', 'Invoiced'],
                ['rejected', 'Rejected'],
                ['deleted', 'Deleted'],
                ['all', 'All'],
              ] as [Filter, string][]
            ).map(([f, label]) => (
              <button key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)} aria-pressed={filter === f}>
                {label} ({count(f)})
              </button>
            ))}
          </div>
        </div>
        {!boss && <p className="muted small" style={{ marginTop: 0 }}>You see the jobs you made. The Boss or Admin approves them.</p>}
        {list.length === 0 ? (
          <Empty>{filter === 'pending' ? 'Nothing waiting for approval.' : 'No jobs here yet.'}</Empty>
        ) : (
          <div className="sj-list">
            {list.map((j) => {
              const own = j.created_by === me.user_id;
              const last = j.updates[j.updates.length - 1];
              return (
                <article key={j.id} className={`sj-card${j.deleted ? ' gone' : j.status === 'approved' && !j.invoiced ? ' due' : ''}`}>
                  {j.deleted && (
                    <div className="sj-deleted small">
                      <b>Deleted</b> by {j.deleted_by_name || 'someone'}
                      {j.deleted_at && ` on ${fmtDateTime(j.deleted_at)}`}
                      <div>Reason: {j.delete_reason}</div>
                    </div>
                  )}
                  <div className="sj-top">
                    <span className={`pill ${j.kind === 'complimentary' ? 'ok' : 'low'}`}>{SPECIAL_KINDS[j.kind]}</span>
                    {j.deleted ? <span className="pill out">Deleted</span> : <span className={`pill ${j.status}`}>{STATUS_LABEL[j.status]}</span>}
                    {j.status === 'approved' && <span className={`pill ${j.invoiced ? 'approved' : 'out'}`}>{j.invoiced ? `Invoiced${j.invoice_no ? ` · ${j.invoice_no}` : ''}` : 'Not invoiced'}</span>}
                    <span className="spacer" />
                    <span className="muted small">{sqmDate(j.job_date)}</span>
                  </div>
                  <h3 className="sj-client">
                    {j.client}
                    {j.job && <span className="muted"> · {j.job}</span>}
                  </h3>
                  <div className="sj-sizes small">
                    {sizesText(j)
                      .split('\n')
                      .map((s, i) => <div key={i}>{s}</div>)}
                    <div>
                      <b>{f2(j.sqm)} m²</b>
                    </div>
                  </div>
                  <p className="small" style={{ margin: '6px 0' }}>
                    <span className="muted">Reason: </span>
                    {j.reason}
                  </p>
                  {j.photos?.length > 0 && (
                    <div className="sj-photos">
                      {j.photos.map((ph, i) => (
                        <button key={ph} className="sj-thumb" onClick={() => setViewing(ph)} aria-label={`Open screenshot ${i + 1} of ${j.client}`}>
                          <Photo path={ph} />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="small sj-stage">
                    <span className="muted">Job status: </span>
                    <b>{SPECIAL_STAGES[j.stage]}</b>
                    {last && <span className="muted"> · {fmtDateTime(last.at)}{last.note ? ` · ${last.note}` : ''}</span>}
                  </div>
                  {j.updates.length > 1 && (
                    <details className="small">
                      <summary className="muted">Status history ({j.updates.length})</summary>
                      <ul className="sj-hist">
                        {[...j.updates].reverse().map((u) => (
                          <li key={u.at}>
                            {fmtDateTime(u.at)} · <b>{SPECIAL_STAGES[u.stage]}</b>
                            {u.note ? ` · ${u.note}` : ''} <span className="muted">({u.by})</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="muted small" style={{ marginTop: 4 }}>
                    Made by {j.created_by_name || 'someone'}
                    {j.decided_by_name && ` · ${j.status === 'approved' ? 'approved' : 'rejected'} by ${j.decided_by_name}`}
                    {j.decide_note && `: ${j.decide_note}`}
                    {j.invoiced && j.invoiced_by_name && ` · invoiced ticked by ${j.invoiced_by_name}`}
                  </div>
                  {!j.deleted && <div className="sj-actions">
                    {own && (
                      <>
                        <button className="btn small" onClick={() => setStaging(j)}>
                          Update job status
                        </button>
                        <button className="btn small ghost" onClick={() => setEditing(j)}>
                          Edit
                        </button>
                        {j.status !== 'approved' && (
                          <button className="btn small ghost" onClick={() => setDeleting(j)}>
                            Delete
                          </button>
                        )}
                      </>
                    )}
                    {boss && j.status === 'pending' && (
                      <>
                        <button className="btn small primary" onClick={() => approve(j)}>
                          Approve
                        </button>
                        <button className="btn small danger" onClick={() => setRejecting(j)}>
                          Reject
                        </button>
                      </>
                    )}
                    {boss && j.status === 'approved' &&
                      (j.invoiced ? (
                        <button
                          className="btn small ghost"
                          onClick={() => confirm(`Mark ${j.client} as NOT invoiced?`) && dispatch({ kind: 'invoiceSpecial', id: newId(), job_id: j.id, invoiced: false, invoice_no: '' })}
                        >
                          Untick invoiced
                        </button>
                      ) : (
                        <button className="btn small primary" onClick={() => setInvoicing(j)}>
                          ✓ Mark invoiced
                        </button>
                      ))}
                  </div>}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {viewing && (
        <Modal title="Screenshot" onClose={() => setViewing(null)}>
          <Photo path={viewing} full />
        </Modal>
      )}
      {deleting && (
        <NoteForm
          title={`Delete: ${deleting.client}`}
          label="Why are you deleting this job?"
          button="Delete job"
          danger
          min={3}
          onClose={() => setDeleting(null)}
          onSave={(reason) => dispatch({ kind: 'deleteSpecial', id: newId(), job_id: deleting.id, reason }) && (toast('Job deleted: it is kept under Deleted with your reason'), true)}
        />
      )}
      {editing && <JobForm kind={kind} job={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {staging && <StageForm job={staging} onClose={() => setStaging(null)} />}
      {rejecting && (
        <NoteForm
          title={`Reject: ${rejecting.client}`}
          label="Why is it rejected?"
          button="Reject"
          danger
          min={3}
          onClose={() => setRejecting(null)}
          onSave={(note) => dispatch({ kind: 'decideSpecial', id: newId(), job_id: rejecting.id, approve: false, note }) && (toast('Job rejected'), true)}
        />
      )}
      {invoicing && (
        <NoteForm
          title={`Invoiced: ${invoicing.client}`}
          label="Invoice number (optional)"
          button="Mark invoiced"
          min={0}
          onClose={() => setInvoicing(null)}
          onSave={(no) => dispatch({ kind: 'invoiceSpecial', id: newId(), job_id: invoicing.id, invoiced: true, invoice_no: no }) && (toast('Marked invoiced'), true)}
        />
      )}
    </>
  );
}

function match(j: SpecialJob, f: Filter) {
  if (f === 'all') return true;
  if (f === 'deleted' || j.deleted) return f === 'deleted' && !!j.deleted;
  if (f === 'pending' || f === 'rejected') return j.status === f;
  return j.status === 'approved' && j.invoiced === (f === 'invoiced');
}

function JobForm({ kind, job, onClose }: { kind: SpecialKind; job: SpecialJob | null; onClose: () => void }) {
  const { data, dispatch, toast } = useStore();
  const [client, setClient] = useState(job?.client ?? '');
  const [title, setTitle] = useState(job?.job ?? '');
  const [date, setDate] = useState(job?.job_date ?? kigaliDay());
  const [reason, setReason] = useState(job?.reason ?? '');
  const [photos, setPhotos] = useState<string[]>(job?.photos ?? []);
  const [uploading, setUploading] = useState(0);
  const addPhotos = async (files: File[]) => {
    const room = 6 - photos.length;
    const take = files.filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, room));
    if (files.length && room <= 0) return toast('At most 6 screenshots per job.', 'error');
    for (const f of take) {
      setUploading((n) => n + 1);
      try {
        const path = await backend.uploadPhoto(await shrinkPhoto(f));
        setPhotos((ps) => (ps.length < 6 ? [...ps, path] : ps));
      } catch (e) {
        toast(`Could not add the screenshot: ${(e as Error).message}`, 'error');
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      addPhotos(files);
    }
  };
  const [lines, setLines] = useState<LineDraft[]>(
    job?.lines.map((l) => ({ material: l.material, w: String(l.width_cm), h: String(l.height_cm), qty: String(l.qty) })) ?? [{ material: '', w: '', h: '', qty: '1' }],
  );
  const parsed = lines.map((l) => ({ material: l.material.trim(), width_cm: Number(l.w.replace(',', '.')), height_cm: Number(l.h.replace(',', '.')), qty: Number(l.qty) || 0 }));
  const filled = parsed.filter((l, i) => l.width_cm > 0 || l.height_cm > 0 || lines[i].material.trim());
  const sqm = specialSqm(filled.filter((l) => l.width_cm > 0 && l.height_cm > 0 && l.qty > 0));
  const set = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const materials = useMemo(() => [...new Set(data.sqmMaterials.map((m) => m.name))].sort(), [data.sqmMaterials]);

  const save = () => {
    const fields: SpecialFields = { kind, client, job: title, job_date: date, lines: filled, reason, photos };
    if (uploading) return toast('Please wait: screenshots are still uploading.', 'error');
    if (job && job.status !== 'pending' && !confirm('Saving changes sends this job back to the Boss for approval. Continue?')) return;
    if (dispatch({ kind: 'saveSpecial', id: newId(), job_id: job?.id ?? newId(), fields })) {
      toast(job ? 'Job saved: waiting for approval again' : 'Job saved: waiting for approval');
      onClose();
    }
  };

  return (
    <Modal
      title={`${job ? 'Edit' : 'New'} ${kind === 'complimentary' ? 'complimentary' : 'no sales order'} job`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small">Total {f2(sqm)} m²</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            {job ? 'Save' : 'Send for approval'}
          </button>
        </>
      }
    >
            <div className="fields">
        <Field label="Client name *">
          <input value={client} onChange={(e) => setClient(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Job / brand">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Shop front stickers" />
        </Field>
        <Field label="Date *">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <h3 className="small" style={{ margin: '14px 0 6px' }}>
        Sizes (cm)
      </h3>
      <datalist id="sj-materials">
        {materials.map((m) => <option key={m} value={m} />)}
      </datalist>
      <div className="sj-lines">
        <div className="sj-line head muted small">
          <span>Material</span>
          <span>Width</span>
          <span>Height</span>
          <span>Qty</span>
          <span>m²</span>
          <span />
        </div>
        {lines.map((l, i) => {
          const p = parsed[i];
          return (
            <div key={i} className="sj-line">
              <input list="sj-materials" value={l.material} onChange={(e) => set(i, { material: e.target.value })} placeholder="e.g. Glossy Sticker" aria-label={`Material ${i + 1}`} maxLength={80} />
              <input inputMode="decimal" value={l.w} onChange={(e) => set(i, { w: e.target.value })} placeholder="90" aria-label={`Width ${i + 1} in cm`} />
              <input inputMode="decimal" value={l.h} onChange={(e) => set(i, { h: e.target.value })} placeholder="120" aria-label={`Height ${i + 1} in cm`} />
              <input inputMode="numeric" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-label={`Quantity ${i + 1}`} />
              <span className="small num">{p.width_cm > 0 && p.height_cm > 0 && p.qty > 0 ? f2((p.width_cm * p.height_cm * p.qty) / 10000) : '–'}</span>
              <button className="btn ghost icon small" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, n) => n !== i) : ls))} aria-label={`Remove size ${i + 1}`} disabled={lines.length === 1}>
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <button className="btn ghost small" style={{ marginTop: 6 }} onClick={() => setLines((ls) => [...ls, { material: ls[ls.length - 1]?.material ?? '', w: '', h: '', qty: '1' }])}>
        + Add size
      </button>
      <div onPaste={onPaste} style={{ marginTop: 12 }}>
        <h3 className="small" style={{ margin: '0 0 6px' }}>
          Screenshots of the job details <span className="muted">(optional, up to 6)</span>
        </h3>
        <div className="sj-photos">
          {photos.map((ph, i) => (
            <span key={ph} className="sj-thumb">
              <Photo path={ph} />
              <button className="sj-x" onClick={() => setPhotos((ps) => ps.filter((x) => x !== ph))} aria-label={`Remove screenshot ${i + 1}`}>
                ✕
              </button>
            </span>
          ))}
          {uploading > 0 && <span className="sj-thumb sj-wait small muted">Adding…</span>}
          {photos.length < 6 && (
            <label className="sj-thumb sj-add small">
              + Add picture
              <input type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos([...(e.target.files ?? [])]); e.target.value = ''; }} />
            </label>
          )}
        </div>
        <p className="muted small" style={{ margin: '4px 0 10px' }}>On a computer you can also paste a screenshot here (Ctrl+V / ⌘V).</p>
      </div>
      <Field label="Reason *" full>
        <textarea onPaste={onPaste} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder={kind === 'complimentary' ? 'e.g. Free sample for a new client' : 'e.g. Sales order will come next week'} />
      </Field>
    </Modal>
  );
}

function StageForm({ job, onClose }: { job: SpecialJob; onClose: () => void }) {
  const { dispatch, toast } = useStore();
  const [stage, setStage] = useState<SpecialStage>(job.stage);
  const [note, setNote] = useState('');
  const save = () => {
    if (dispatch({ kind: 'specialStage', id: newId(), job_id: job.id, stage, note, at: new Date().toISOString() })) {
      toast(`Job status: ${SPECIAL_STAGES[stage]}`);
      onClose();
    }
  };
  return (
    <Modal
      title={`Job status: ${job.client}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save update
          </button>
        </>
      }
    >
      <div className="chips" role="group" aria-label="Job status" style={{ marginBottom: 12 }}>
        {STAGE_KEYS.map((k) => (
          <button key={k} className={`chip${stage === k ? ' on' : ''}`} onClick={() => setStage(k)} aria-pressed={stage === k}>
            {SPECIAL_STAGES[k]}
          </button>
        ))}
      </div>
      <Field label="Note (optional)" full>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Printed, waiting for lamination" />
      </Field>
      <p className="muted small">This does not need a new approval.</p>
    </Modal>
  );
}

function NoteForm(props: { title: string; label: string; button: string; danger?: boolean; min: number; onClose: () => void; onSave: (note: string) => boolean | undefined }) {
  const [note, setNote] = useState('');
  const ok = note.trim().length >= props.min;
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button className={`btn ${props.danger ? 'danger' : 'primary'}`} disabled={!ok} onClick={() => props.onSave(note.trim()) && props.onClose()}>
            {props.button}
          </button>
        </>
      }
    >
      <Field label={props.label} full>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </Field>
    </Modal>
  );
}

/** Shows a saved screenshot (links to private pictures are made when needed). */
function Photo({ path, full }: { path: string; full?: boolean }) {
  const [url, setUrl] = useState(path.startsWith('data:') ? path : '');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (url) return;
    let live = true;
    backend.photoUrl(path).then((u) => live && setUrl(u), () => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [path, url]);
  if (failed) return <span className="small muted">Picture not available</span>;
  if (!url) return <span className="small muted">Loading…</span>;
  return full ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Screenshot of the job details" style={{ maxWidth: '100%', maxHeight: '75vh', display: 'block', margin: '0 auto' }} />
    </a>
  ) : (
    <img src={url} alt="" loading="lazy" />
  );
}
