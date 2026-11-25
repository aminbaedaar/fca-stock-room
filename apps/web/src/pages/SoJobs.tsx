import { useEffect, useMemo, useState, type ClipboardEvent } from 'react';
import { can, fmtDateTime, kigaliDay, SO_STEPS, SO_TASKS, soSteps, sqmDate, type SoJob, type SoStep, type SoTask } from '@fca/core';
import { backend, newId, useStore } from '../data/store';
import type { SoFields } from '../data/types';
import { Empty, Field, Modal } from '../components/ui';
import { shrinkPhoto } from '../lib/photo';

type Filter = 'open' | 'late' | SoStep | 'cancelled' | 'all';
const TASK_KEYS = Object.keys(SO_TASKS) as SoTask[];
const MAX_FILES = 10;
/** "SO 1042", or the number as typed when it already starts with SO. */
const soLabel = (n: string) => (/^so\b|^so[-\s]/i.test(n.trim()) ? n.trim() : `SO ${n.trim()}`);

const isLate = (j: SoJob) => !j.cancelled && j.step !== 'done' && !!j.due_date && j.due_date < kigaliDay();
const nextStep = (j: SoJob): SoStep | null => {
  const steps = soSteps(j.sample);
  const i = steps.indexOf(j.step);
  return i >= 0 && i < steps.length - 1 ? steps[i + 1] : null;
};

function match(j: SoJob, f: Filter) {
  if (f === 'all') return true;
  if (f === 'cancelled' || j.cancelled) return f === 'cancelled' && j.cancelled;
  if (f === 'open') return j.step !== 'done';
  if (f === 'late') return isLate(j);
  return j.step === f;
}

// Sales order jobs: every job with a sales order, followed from artwork to delivery.
// Everyone sees all jobs and can move them on; the history keeps who did what and when.
export function SoJobs() {
  const { data, me, dispatch, toast } = useStore();
  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SoJob | 'new' | null>(null);
  const [stepping, setStepping] = useState<{ job: SoJob; to: SoStep } | null>(null);
  const [cancelling, setCancelling] = useState<SoJob | null>(null);

  const jobs = data.soJobs;
  const q = search.trim().toLowerCase();
  const found = useMemo(
    () => (q ? jobs.filter((j) => [j.so_number, j.client, j.job, j.delivery_note, j.created_by_name].some((t) => t.toLowerCase().includes(q))) : jobs),
    [jobs, q],
  );
  const count = (f: Filter) => found.filter((j) => match(j, f)).length;
  const list = found
    .filter((j) => match(j, filter))
    .sort((a, b) => Number(isLate(b)) - Number(isLate(a)) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || b.created_at.localeCompare(a.created_at));

  if (!me) return null;
  const manager = can(me.role, 'approve');

  const tick = (j: SoJob, task: SoTask, done: boolean) => {
    if (dispatch({ kind: 'soTask', id: newId(), job_id: j.id, task, done })) toast(`${SO_TASKS[task]} ${done ? 'done' : 'not done'} · ${j.so_number}`);
  };

  return (
    <>
      <div className="page-head">
        <h1>Sales order jobs</h1>
        <span className="spacer" />
        <input type="search" placeholder="Search SO number, client, job…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 'min(280px, 100%)' }} aria-label="Search jobs" />
        <button className="btn primary" onClick={() => setEditing('new')}>
          + New job
        </button>
      </div>

      <div className="so-tiles">
        {(Object.keys(SO_STEPS) as SoStep[]).map((s) => (
          <button key={s} className={`so-tile${filter === s ? ' on' : ''}${s === 'done' ? ' done' : ''}`} onClick={() => setFilter(s)} aria-pressed={filter === s}>
            <b>{count(s)}</b>
            <span>{SO_STEPS[s]}</span>
          </button>
        ))}
        <button className={`so-tile late${filter === 'late' ? ' on' : ''}`} onClick={() => setFilter('late')} aria-pressed={filter === 'late'}>
          <b>{count('late')}</b>
          <span>Late</span>
        </button>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="chips" role="group" aria-label="Show">
            {(
              [
                ['open', 'Not finished'],
                ['done', 'Finished'],
                ['late', 'Late'],
                ['cancelled', 'Cancelled'],
                ['all', 'All'],
              ] as [Filter, string][]
            ).map(([f, label]) => (
              <button key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)} aria-pressed={filter === f}>
                {label} ({count(f)})
              </button>
            ))}
            {!['open', 'done', 'late', 'cancelled', 'all'].includes(filter) && <span className="chip on">{SO_STEPS[filter as SoStep]} ({count(filter)})</span>}
          </div>
        </div>
        {list.length === 0 ? (
          <Empty>{jobs.length === 0 ? 'No sales order jobs yet. Press “+ New job” to add the first one.' : 'No jobs here.'}</Empty>
        ) : (
          <div className="sj-list">
            {list.map((j) => {
              const steps = soSteps(j.sample);
              const at = steps.indexOf(j.step);
              const next = nextStep(j);
              const last = j.updates[j.updates.length - 1];
              const mayEdit = !j.cancelled && (j.created_by === me.user_id || manager);
              return (
                <article key={j.id} className={`sj-card${j.cancelled ? ' gone' : isLate(j) ? ' due' : ''}`}>
                  {j.cancelled && (
                    <div className="sj-deleted small">
                      <b>Cancelled</b> by {j.cancelled_by_name || 'someone'}
                      {j.cancelled_at && ` on ${fmtDateTime(j.cancelled_at)}`}
                      <div>Reason: {j.cancel_reason}</div>
                    </div>
                  )}
                  <div className="sj-top">
                    <span className="pill so-no">{soLabel(j.so_number)}</span>
                    <span className={`pill ${j.step === 'done' ? 'approved' : 'pending'}`}>{SO_STEPS[j.step]}</span>
                    {!j.sample && <span className="pill">Straight to printing</span>}
                    <span className="spacer" />
                    {j.due_date && <span className={`small ${isLate(j) ? 'neg' : 'muted'}`}>{isLate(j) ? 'Late · due ' : 'Due '}{sqmDate(j.due_date)}</span>}
                  </div>
                  <h3 className="sj-client">
                    {j.client}
                    {j.job && <span className="muted"> · {j.job}</span>}
                  </h3>

                  <ol className="so-track" aria-label="Job steps">
                    {steps.map((s, i) => (
                      <li key={s} className={i < at ? 'past' : i === at ? 'now' : ''} title={SO_STEPS[s]}>
                        <span className="dot">{i < at || j.step === 'done' ? '✓' : i + 1}</span>
                        <span className="lbl">{SO_STEPS[s]}</span>
                      </li>
                    ))}
                  </ol>

                  {j.tasks.length > 0 && (
                    <div className="so-tasks">
                      <span className="muted small">Production:</span>
                      {j.tasks.map((t) => (
                        <button
                          key={t.task}
                          className={`chip small${t.done ? ' on' : ''}`}
                          disabled={j.cancelled}
                          onClick={() => tick(j, t.task, !t.done)}
                          title={t.done ? `Done by ${t.by}${t.at ? ` · ${fmtDateTime(t.at)}` : ''} (tap to undo)` : 'Tap when done'}
                          aria-pressed={t.done}
                        >
                          {t.done ? '✓ ' : '○ '}
                          {SO_TASKS[t.task]}
                        </button>
                      ))}
                    </div>
                  )}

                  {j.files.length > 0 && (
                    <div className="sj-photos">
                      {j.files.map((f, i) => <FileThumb key={f} path={f} label={`File ${i + 1} of ${soLabel(j.so_number)}`} />)}
                    </div>
                  )}
                  {j.notes && <p className="small" style={{ margin: '6px 0' }}>{j.notes}</p>}
                  {j.delivery_note && (
                    <div className="small">
                      <span className="muted">Delivery note: </span>
                      <b>{j.delivery_note}</b>
                    </div>
                  )}
                  {last && (
                    <div className="small sj-stage">
                      <span className="muted">Last update: </span>
                      <b>{SO_STEPS[last.step]}</b>
                      <span className="muted"> · {fmtDateTime(last.at)} · {last.by}{last.note ? ` · ${last.note}` : ''}</span>
                    </div>
                  )}
                  {j.updates.length > 1 && (
                    <details className="small">
                      <summary className="muted">History ({j.updates.length})</summary>
                      <ul className="sj-hist">
                        {[...j.updates].reverse().map((u) => (
                          <li key={u.at}>
                            {fmtDateTime(u.at)} · <b>{SO_STEPS[u.step]}</b>
                            {u.note ? ` · ${u.note}` : ''} <span className="muted">({u.by})</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="muted small" style={{ marginTop: 4 }}>
                    Added by {j.created_by_name || 'someone'} · {fmtDateTime(j.created_at)}
                  </div>
                  {!j.cancelled && (
                    <div className="sj-actions">
                      {next && (
                        <button className="btn small primary" onClick={() => setStepping({ job: j, to: next })}>
                          Move to: {SO_STEPS[next]}
                        </button>
                      )}
                      <button className="btn small" onClick={() => setStepping({ job: j, to: j.step })}>
                        Update / change step
                      </button>
                      {mayEdit && (
                        <button className="btn small ghost" onClick={() => setEditing(j)}>
                          Edit
                        </button>
                      )}
                      {mayEdit && j.step !== 'done' && (
                        <button className="btn small ghost" onClick={() => setCancelling(j)}>
                          Cancel job
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {editing && <JobForm job={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {stepping && <StepForm job={stepping.job} start={stepping.to} onClose={() => setStepping(null)} />}
      {cancelling && <CancelForm job={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}

function JobForm({ job, onClose }: { job: SoJob | null; onClose: () => void }) {
  const { data, dispatch, toast } = useStore();
  const [so, setSo] = useState(job?.so_number ?? '');
  const [client, setClient] = useState(job?.client ?? '');
  const [title, setTitle] = useState(job?.job ?? '');
  const [due, setDue] = useState(job?.due_date ?? '');
  const [sample, setSample] = useState(job?.sample ?? true);
  const [tasks, setTasks] = useState<SoTask[]>(job?.tasks.map((t) => t.task) ?? ['printing']);
  const [files, setFiles] = useState<string[]>(job?.files ?? []);
  const [notes, setNotes] = useState(job?.notes ?? '');
  const [uploading, setUploading] = useState(0);
  const dup = so.trim() && data.soJobs.find((j) => j.id !== job?.id && !j.cancelled && j.so_number.toLowerCase() === so.trim().toLowerCase());

  const addFiles = async (picked: File[]) => {
    const room = MAX_FILES - files.length;
    if (picked.length && room <= 0) return toast(`At most ${MAX_FILES} files per job.`, 'error');
    for (const f of picked.slice(0, Math.max(0, room))) {
      const pdf = f.type === 'application/pdf';
      if (!pdf && !f.type.startsWith('image/')) {
        toast(`${f.name}: only pictures and PDFs can be added.`, 'error');
        continue;
      }
      if (pdf && f.size > 10 * 1024 * 1024) {
        toast(`${f.name} is bigger than 10 MB.`, 'error');
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const path = await backend.uploadPhoto(pdf ? f : await shrinkPhoto(f), 'so-jobs');
        setFiles((ps) => (ps.length < MAX_FILES ? [...ps, path] : ps));
      } catch (e) {
        toast(`Could not add ${f.name}: ${(e as Error).message}`, 'error');
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const onPaste = (e: ClipboardEvent) => {
    const picked = [...e.clipboardData.files];
    if (picked.length) {
      e.preventDefault();
      addFiles(picked);
    }
  };

  const save = () => {
    if (uploading) return toast('Please wait: files are still uploading.', 'error');
    const fields: SoFields = { so_number: so, client, job: title, due_date: due || null, sample, tasks, files, notes };
    if (dispatch({ kind: 'saveSo', id: newId(), job_id: job?.id ?? newId(), fields })) {
      toast(job ? 'Job saved' : `Job added: ${soLabel(so)}`);
      onClose();
    }
  };

  return (
    <Modal
      title={job ? `Edit job · ${soLabel(job.so_number)}` : 'New sales order job'}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            {job ? 'Save' : 'Add job'}
          </button>
        </>
      }
    >
      <div className="fields" onPaste={onPaste}>
        <Field label="Sales order number *">
          <input value={so} onChange={(e) => setSo(e.target.value)} maxLength={60} placeholder="e.g. SO-1042" autoFocus />
        </Field>
        <Field label="Client name *">
          <input value={client} onChange={(e) => setClient(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Job">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Shop front stickers, 3 roll-ups" />
        </Field>
        <Field label="Due date">
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
      {dup && <p className="small neg" style={{ margin: '4px 0 0' }}>Another job already uses {soLabel(dup.so_number)} ({dup.client}). Check it is not added twice.</p>}

      <h3 className="small" style={{ margin: '14px 0 6px' }}>After the artwork is shared</h3>
      <div className="chips" role="radiogroup" aria-label="Sample or straight to printing">
        <button className={`chip${sample ? ' on' : ''}`} role="radio" aria-checked={sample} onClick={() => setSample(true)}>
          Sample first
        </button>
        <button className={`chip${!sample ? ' on' : ''}`} role="radio" aria-checked={!sample} onClick={() => setSample(false)}>
          Straight to printing
        </button>
      </div>

      <h3 className="small" style={{ margin: '14px 0 6px' }}>Production work</h3>
      <div className="chips" role="group" aria-label="Production tasks">
        {TASK_KEYS.map((t) => {
          const on = tasks.includes(t);
          return (
            <button key={t} className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setTasks((ts) => (on ? ts.filter((x) => x !== t) : [...ts, t]))}>
              {on ? '✓ ' : ''}
              {SO_TASKS[t]}
            </button>
          );
        })}
      </div>

      <h3 className="small" style={{ margin: '14px 0 6px' }}>
        Sales order and artwork <span className="muted">(photos or PDFs, up to {MAX_FILES})</span>
      </h3>
      <div className="sj-photos" onPaste={onPaste}>
        {files.map((f, i) => (
          <span key={f} className="sj-thumb">
            <FileThumb path={f} label={`File ${i + 1}`} plain />
            <button className="sj-x" onClick={() => setFiles((ps) => ps.filter((x) => x !== f))} aria-label={`Remove file ${i + 1}`}>
              ✕
            </button>
          </span>
        ))}
        {uploading > 0 && <span className="sj-thumb sj-wait small muted">Adding…</span>}
        {files.length < MAX_FILES && (
          <label className="sj-thumb sj-add small">
            + Add photo / PDF
            <input type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
          </label>
        )}
      </div>
      <p className="muted small" style={{ margin: '4px 0 10px' }}>Take a photo of the sales order with your phone, or paste a screenshot here (Ctrl+V / ⌘V).</p>

      <Field label="Notes" full>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} placeholder="e.g. Client wants matte finish; deliver to Kigali Heights" />
      </Field>
    </Modal>
  );
}

function StepForm({ job, start, onClose }: { job: SoJob; start: SoStep; onClose: () => void }) {
  const { dispatch, toast } = useStore();
  const [step, setStep] = useState<SoStep>(start);
  const [note, setNote] = useState('');
  const [dn, setDn] = useState(job.delivery_note);
  const openTasks = job.tasks.filter((t) => !t.done);
  const needsDn = step === 'done' && !dn.trim();
  const save = () => {
    if (dispatch({ kind: 'soStep', id: newId(), job_id: job.id, step, note, delivery_note: dn, at: new Date().toISOString() })) {
      toast(`${soLabel(job.so_number)}: ${SO_STEPS[step]}`);
      onClose();
    }
  };
  return (
    <Modal
      title={`${soLabel(job.so_number)} · ${job.client}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={needsDn}>
            Save update
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>Choose the step the job is at now. You can also stay on the same step and just add a note.</p>
      <div className="chips" role="radiogroup" aria-label="Step" style={{ marginBottom: 12 }}>
        {soSteps(job.sample).map((s) => (
          <button key={s} className={`chip${step === s ? ' on' : ''}`} role="radio" aria-checked={step === s} onClick={() => setStep(s)}>
            {SO_STEPS[s]}
          </button>
        ))}
      </div>
      {(step === 'delivery' || step === 'done') && openTasks.length > 0 && (
        <p className="small neg">Production not ticked as done yet: {openTasks.map((t) => SO_TASKS[t.task]).join(', ')}.</p>
      )}
      {(step === 'delivery' || step === 'done') && (
        <Field label={step === 'done' ? 'Delivery note number *' : 'Delivery note number'} full>
          <input value={dn} onChange={(e) => setDn(e.target.value)} maxLength={60} placeholder="e.g. DN-0889" />
        </Field>
      )}
      <Field label="Note (optional)" full>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Client approved the sample by WhatsApp" />
      </Field>
    </Modal>
  );
}

function CancelForm({ job, onClose }: { job: SoJob; onClose: () => void }) {
  const { dispatch, toast } = useStore();
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={`Cancel job · ${soLabel(job.so_number)}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Keep job
          </button>
          <button
            className="btn danger"
            disabled={reason.trim().length < 3}
            onClick={() => dispatch({ kind: 'cancelSo', id: newId(), job_id: job.id, reason }) && (toast('Job cancelled: it is kept under Cancelled with your reason'), onClose())}
          >
            Cancel job
          </button>
        </>
      }
    >
      <Field label="Why is this job cancelled? *" full>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus />
      </Field>
    </Modal>
  );
}

/** A sales order / artwork file: picture thumbnail or a PDF tile; opens full size in a new tab. */
function FileThumb({ path, label, plain }: { path: string; label: string; plain?: boolean }) {
  const pdf = path.endsWith('.pdf') || path.startsWith('data:application/pdf');
  const [url, setUrl] = useState(path.startsWith('data:') ? path : '');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (url) return;
    let live = true;
    backend.photoUrl(path, 'so-jobs').then((u) => live && setUrl(u), () => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [path, url]);
  const inner = failed ? <span className="small muted">Not available</span> : !url ? <span className="small muted">Loading…</span> : pdf ? <span className="so-pdf">PDF</span> : <img src={url} alt="" loading="lazy" />;
  if (plain) return inner;
  return url && !failed ? (
    <a className="sj-thumb" href={url} target="_blank" rel="noreferrer" aria-label={`Open ${label}`}>
      {inner}
    </a>
  ) : (
    <span className="sj-thumb">{inner}</span>
  );
}
