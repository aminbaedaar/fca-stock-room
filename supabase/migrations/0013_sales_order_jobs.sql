-- Sales order jobs: follow every job that has a sales order, step by step.
--   Artwork shared → Sample → Sample approved → Production → Delivery → Finished
--   (jobs that go straight to printing skip the two sample steps).
-- Production has its own tasks (printing, cutting, print & cut, plotting …),
-- each ticked off by whoever did it. Finishing a job needs the delivery note number.
-- Everyone on the team can add a job, see all jobs and move them on; every change
-- is kept in the job's history with who and when. Only the person who made the job
-- or a Manager / Boss / Admin can edit its details or cancel it (with a reason).
-- Run with: supabase db query -f (after 0012).

create table if not exists public.so_jobs (
  id              uuid primary key,
  so_number       text not null check (length(so_number) between 1 and 60),
  client          text not null check (length(client) between 1 and 120),
  job             text not null default '' check (length(job) <= 200),
  due_date        date,
  sample          boolean not null default true,       -- false = straight to printing
  tasks           jsonb not null default '[]'::jsonb,  -- [{"task","done","by","at"}]
  files           jsonb not null default '[]'::jsonb,  -- sales order / artwork: paths in the so-jobs bucket
  notes           text not null default '' check (length(notes) <= 1000),
  step            text not null default 'artwork'
                  check (step in ('artwork', 'sample', 'sample_ok', 'production', 'delivery', 'done')),
  delivery_note   text not null default '' check (length(delivery_note) <= 60),
  updates         jsonb not null default '[]'::jsonb,  -- [{"at","step","note","by"}], newest last
  cancelled       boolean not null default false,
  cancelled_at    timestamptz,
  cancelled_by_name text not null default '',
  cancel_reason   text not null default '' check (length(cancel_reason) <= 300),
  created_by      uuid references auth.users (id) on delete set null,
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists so_jobs_created_idx on public.so_jobs (created_at desc);

alter table public.so_jobs enable row level security;
drop policy if exists "team sees sales order jobs" on public.so_jobs;
create policy "team sees sales order jobs" on public.so_jobs
  for select to authenticated using (public.fca_can('special'));
revoke insert, update, delete on public.so_jobs from anon, authenticated;
do $$ begin
  alter publication supabase_realtime add table public.so_jobs;
exception when duplicate_object then null; end $$;

-- A cancelled job cannot be changed again.
create or replace function public.so_jobs_keep_cancelled() returns trigger
language plpgsql as $$
begin
  if old.cancelled then raise exception 'This job was cancelled and cannot be changed.'; end if;
  return new;
end $$;
drop trigger if exists so_jobs_keep_cancelled on public.so_jobs;
create trigger so_jobs_keep_cancelled before update or delete on public.so_jobs
  for each row execute function public.so_jobs_keep_cancelled();

create or replace function public.fca_iso(t timestamptz) returns text
language sql immutable as $$ select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- Add a job, or change its details (the person who made it, or a Manager / Boss / Admin).
create or replace function public.save_so_job(
  p_id uuid, p_so_number text, p_client text, p_job text, p_due date, p_sample boolean,
  p_tasks jsonb, p_files jsonb, p_notes text
) returns public.so_jobs
language plpgsql security definer set search_path = public as $$
declare
  v_old public.so_jobs;
  v_row public.so_jobs;
  v_so text := public.fca_clean(p_so_number, 60);
  v_client text := public.fca_clean(p_client, 120);
  v_job text := public.fca_clean(p_job, 200);
  v_notes text := public.fca_clean(p_notes, 1000);
  v_files jsonb := coalesce(p_files, '[]'::jsonb);
  v_tasks jsonb := '[]'::jsonb;
  v_t text;
  v_prev jsonb;
begin
  perform public.fca_require('special');
  if v_so = '' then raise exception 'Enter the sales order number.'; end if;
  if v_client = '' then raise exception 'Enter the client name.'; end if;
  if jsonb_typeof(coalesce(p_tasks, '[]'::jsonb)) <> 'array' then raise exception 'Production tasks are not valid.'; end if;
  if jsonb_typeof(v_files) <> 'array' or jsonb_array_length(v_files) > 10 then raise exception 'At most 10 files per job.'; end if;
  if exists (select 1 from jsonb_array_elements(v_files) x where jsonb_typeof(x) <> 'string' or length(x #>> '{}') > 300) then
    raise exception 'File list is not valid.';
  end if;

  select * into v_old from public.so_jobs where id = p_id for update;

  -- tasks: keep what was already ticked
  for v_t in select x from jsonb_array_elements_text(coalesce(p_tasks, '[]'::jsonb)) with ordinality a(x, n) group by x order by min(n) loop
    if v_t not in ('printing', 'cutting', 'print_cut', 'plotting', 'lamination', 'mounting', 'other') then
      raise exception 'Unknown production task: %', v_t;
    end if;
    select e into v_prev from jsonb_array_elements(coalesce(v_old.tasks, '[]'::jsonb)) e where e ->> 'task' = v_t;
    v_tasks := v_tasks || coalesce(v_prev, jsonb_build_object('task', v_t, 'done', false, 'by', '', 'at', null));
  end loop;

  if v_old.id is null then
    insert into public.so_jobs (id, so_number, client, job, due_date, sample, tasks, files, notes, updates, created_by, created_by_name)
    values (p_id, v_so, v_client, v_job, p_due, coalesce(p_sample, true), v_tasks, v_files, v_notes,
            jsonb_build_array(jsonb_build_object('at', public.fca_iso(now()), 'step', 'artwork', 'note', 'Job added', 'by', coalesce(public.fca_my_name(), ''))),
            auth.uid(), coalesce(public.fca_my_name(), ''))
    returning * into v_row;
    return v_row;
  end if;

  if v_old.created_by is distinct from auth.uid() and not public.fca_can('approve') then
    raise exception 'Only the person who made this job or a Manager can change its details.';
  end if;
  if not coalesce(p_sample, true) and v_old.step in ('sample', 'sample_ok') then
    raise exception 'This job is at the sample step. Move it on first.';
  end if;
  update public.so_jobs set
    so_number = v_so, client = v_client, job = v_job, due_date = p_due, sample = coalesce(p_sample, true),
    tasks = v_tasks, files = v_files, notes = v_notes, updated_at = now()
  where id = p_id
    and (so_number, client, job, due_date, sample, tasks, files, notes) is distinct from
        (v_so, v_client, v_job, p_due, coalesce(p_sample, true), v_tasks, v_files, v_notes)
  returning * into v_row;
  if not found then return v_old; end if; -- nothing changed (or sent twice)
  return v_row;
end $$;

-- Move a job to a step (anyone on the team). Finished needs the delivery note number.
create or replace function public.so_job_step(p_job uuid, p_step text, p_note text, p_delivery_note text, p_at timestamptz)
returns public.so_jobs
language plpgsql security definer set search_path = public as $$
declare
  v public.so_jobs;
  v_at text := public.fca_iso(least(coalesce(p_at, now()), now()));
  v_dn text := public.fca_clean(p_delivery_note, 60);
begin
  perform public.fca_require('special');
  if p_step not in ('artwork', 'sample', 'sample_ok', 'production', 'delivery', 'done') then raise exception 'Unknown step.'; end if;
  select * into v from public.so_jobs where id = p_job for update;
  if not found then raise exception 'Job not found.'; end if;
  if v.cancelled then raise exception 'This job was cancelled and cannot be changed.'; end if;
  if exists (select 1 from jsonb_array_elements(v.updates) u where u ->> 'at' = v_at) then return v; end if; -- sent twice
  if not v.sample and p_step in ('sample', 'sample_ok') then raise exception 'This job goes straight to printing (no sample). Edit the job to add a sample.'; end if;
  if v_dn = '' then v_dn := v.delivery_note; end if;
  if p_step = 'done' and v_dn = '' then raise exception 'Enter the delivery note number to finish the job.'; end if;
  update public.so_jobs set
    step = p_step,
    delivery_note = v_dn,
    updates = updates || jsonb_build_object('at', v_at, 'step', p_step, 'note', public.fca_clean(p_note, 300), 'by', coalesce(public.fca_my_name(), '')),
    updated_at = now()
  where id = p_job
  returning * into v;
  return v;
end $$;

-- Tick (or untick) a production task (anyone on the team).
create or replace function public.so_job_task(p_job uuid, p_task text, p_done boolean)
returns public.so_jobs
language plpgsql security definer set search_path = public as $$
declare
  v public.so_jobs;
begin
  perform public.fca_require('special');
  select * into v from public.so_jobs where id = p_job for update;
  if not found then raise exception 'Job not found.'; end if;
  if v.cancelled then raise exception 'This job was cancelled and cannot be changed.'; end if;
  if not exists (select 1 from jsonb_array_elements(v.tasks) e where e ->> 'task' = p_task) then raise exception 'This job has no such task.'; end if;
  if exists (select 1 from jsonb_array_elements(v.tasks) e where e ->> 'task' = p_task and (e ->> 'done')::boolean = p_done) then return v; end if;
  update public.so_jobs set
    tasks = (select jsonb_agg(case when e ->> 'task' = p_task
                                   then jsonb_build_object('task', p_task, 'done', p_done,
                                          'by', case when p_done then coalesce(public.fca_my_name(), '') else '' end,
                                          'at', case when p_done then public.fca_iso(now()) else null end)
                                   else e end)
             from jsonb_array_elements(v.tasks) e),
    updated_at = now()
  where id = p_job
  returning * into v;
  return v;
end $$;

-- Cancel a job (kept, with who, when and why): the person who made it or a Manager / Boss / Admin.
create or replace function public.cancel_so_job(p_job uuid, p_reason text)
returns public.so_jobs
language plpgsql security definer set search_path = public as $$
declare
  v public.so_jobs;
  v_reason text := public.fca_clean(p_reason, 300);
begin
  perform public.fca_require('special');
  select * into v from public.so_jobs where id = p_job for update;
  if not found then raise exception 'Job not found.'; end if;
  if v.cancelled then return v; end if; -- sent twice
  if v.created_by is distinct from auth.uid() and not public.fca_can('approve') then
    raise exception 'Only the person who made this job or a Manager can cancel it.';
  end if;
  if length(v_reason) < 3 then raise exception 'Please write why the job is cancelled.'; end if;
  update public.so_jobs set
    cancelled = true, cancelled_at = now(), cancelled_by_name = coalesce(public.fca_my_name(), ''), cancel_reason = v_reason, updated_at = now()
  where id = p_job
  returning * into v;
  return v;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'save_so_job(uuid, text, text, text, date, boolean, jsonb, jsonb, text)',
    'so_job_step(uuid, text, text, text, timestamptz)',
    'so_job_task(uuid, text, boolean)',
    'cancel_so_job(uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Files (sales order, artwork): a private bucket everyone on the team can see.
-- People upload into their own folder (<their user id>/...).
do $$
begin
  if to_regclass('storage.objects') is null then return; end if; -- not on Supabase (tests)
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('so-jobs', 'so-jobs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do nothing;

  drop policy if exists "so jobs: upload own files" on storage.objects;
  create policy "so jobs: upload own files" on storage.objects for insert to authenticated
    with check (bucket_id = 'so-jobs' and public.fca_can('special') and (storage.foldername(name))[1] = auth.uid()::text);

  drop policy if exists "so jobs: team sees files" on storage.objects;
  create policy "so jobs: team sees files" on storage.objects for select to authenticated
    using (bucket_id = 'so-jobs' and public.fca_can('special'));

  drop policy if exists "so jobs: delete own files" on storage.objects;
  create policy "so jobs: delete own files" on storage.objects for delete to authenticated
    using (bucket_id = 'so-jobs' and (storage.foldername(name))[1] = auth.uid()::text);
end $$;
