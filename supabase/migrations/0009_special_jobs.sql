-- Special jobs: Complimentary jobs and jobs without a sales order.
-- Anyone can enter one. The Boss or Admin approves it, then ticks "Invoiced"
-- when it has been invoiced (weekly PDF for checking).
-- Only the person who made a job can change its details or job status.
-- Changing the details of an approved or rejected job sends it back for approval.
-- Run once in the Supabase SQL Editor.

create table if not exists public.special_jobs (
  id               uuid primary key,
  kind             text not null check (kind in ('complimentary', 'no_sales_order')),
  client           text not null check (length(client) between 1 and 120),
  job              text not null default '' check (length(job) <= 120),
  job_date         date not null,
  lines            jsonb not null default '[]'::jsonb, -- [{"material","width_cm","height_cm","qty"}]
  sqm              numeric(12, 2) not null default 0,
  reason           text not null check (length(reason) between 3 and 500),
  photos           jsonb not null default '[]'::jsonb, -- screenshots: file paths in the special-jobs storage bucket
  stage            text not null default 'not_started'
                   check (stage in ('not_started', 'design', 'printing', 'finishing', 'ready', 'delivered')),
  updates          jsonb not null default '[]'::jsonb, -- [{"at","stage","note","by"}], newest last
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by       uuid references auth.users (id) on delete set null,
  decided_by_name  text not null default '',
  decided_at       timestamptz,
  decide_note      text not null default '' check (length(decide_note) <= 300),
  invoiced         boolean not null default false,
  invoice_no       text not null default '' check (length(invoice_no) <= 60),
  invoiced_by_name text not null default '',
  invoiced_at      timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  created_by_name  text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists special_jobs_date_idx on public.special_jobs (job_date desc);

alter table public.special_jobs enable row level security;
drop policy if exists "own special jobs, boss and admin see all" on public.special_jobs;
create policy "own special jobs, boss and admin see all" on public.special_jobs
  for select to authenticated
  using (public.fca_can('approve_special') or (public.fca_can('special') and created_by = auth.uid()));
revoke insert, update, delete on public.special_jobs from anon, authenticated;
do $$ begin
  alter publication supabase_realtime add table public.special_jobs;
exception when duplicate_object then null; end $$;

-- Must match packages/core/src/roles.ts (a test checks this).
create or replace function public.fca_can(perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.fca_my_role()::text = any (
    case perm
      -- PERMISSIONS START
      when 'view' then array['admin', 'boss', 'manager', 'staff']
      when 'calculator' then array['admin', 'boss', 'manager', 'staff', 'viewer']
      when 'special' then array['admin', 'boss', 'manager', 'staff', 'viewer']
      when 'approve_special' then array['admin', 'boss']
      when 'request' then array['admin', 'boss', 'manager', 'staff']
      when 'stock' then array['admin', 'boss', 'manager', 'staff']
      when 'adjust' then array['admin', 'boss', 'manager']
      when 'items' then array['admin', 'boss', 'manager']
      when 'approve' then array['admin', 'boss', 'manager']
      when 'stocktake' then array['admin', 'boss', 'manager']
      when 'summary' then array['admin', 'boss', 'manager']
      when 'void' then array['admin', 'boss', 'manager']
      when 'import' then array['admin']
      when 'roles' then array['admin']
      when 'backup' then array['admin']
      -- PERMISSIONS END
      else array[]::text[]
    end
  ), false)
$$;

-- Add a job, or change your own job. Changing an approved/rejected job sends it back for approval.
create or replace function public.save_special_job(
  p_id uuid, p_kind text, p_client text, p_job text, p_date date, p_lines jsonb, p_reason text, p_photos jsonb default '[]'::jsonb
) returns public.special_jobs
language plpgsql security definer set search_path = public as $$
declare
  v_old public.special_jobs;
  v_row public.special_jobs;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_sqm numeric := 0;
  v_w numeric; v_h numeric; v_q integer;
  v_client text := public.fca_clean(p_client, 120);
  v_reason text := public.fca_clean(p_reason, 500);
  v_changed boolean;
  v_photos jsonb := coalesce(p_photos, '[]'::jsonb);
begin
  perform public.fca_require('special');
  if p_kind not in ('complimentary', 'no_sales_order') then raise exception 'Choose Complimentary or No sales order.'; end if;
  if v_client = '' then raise exception 'Enter the client name.'; end if;
  if length(v_reason) < 3 then raise exception 'Please write the reason.'; end if;
  if p_date is null then raise exception 'Enter the job date.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one size.'; end if;
  if jsonb_array_length(p_lines) > 50 then raise exception 'At most 50 sizes per job.'; end if;
  if jsonb_typeof(v_photos) <> 'array' or jsonb_array_length(v_photos) > 6 then raise exception 'At most 6 screenshots per job.'; end if;
  if exists (select 1 from jsonb_array_elements(v_photos) x where jsonb_typeof(x) <> 'string' or length(x #>> '{}') > 300) then
    raise exception 'Screenshot list is not valid.';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_w := (v_line ->> 'width_cm')::numeric;
    v_h := (v_line ->> 'height_cm')::numeric;
    v_q := coalesce((v_line ->> 'qty')::integer, 1);
    if v_w is null or v_h is null or v_w <= 0 or v_h <= 0 then raise exception 'Every size needs a width and height above 0.'; end if;
    if v_q < 1 then raise exception 'Quantity must be 1 or more.'; end if;
    v_lines := v_lines || jsonb_build_object('material', public.fca_clean(v_line ->> 'material', 80), 'width_cm', round(v_w, 1), 'height_cm', round(v_h, 1), 'qty', v_q);
    v_sqm := v_sqm + v_w * v_h * v_q / 10000;
  end loop;

  select * into v_old from public.special_jobs where id = p_id for update;
  if not found then
    insert into public.special_jobs (id, kind, client, job, job_date, lines, sqm, reason, photos, created_by, created_by_name)
    values (p_id, p_kind, v_client, public.fca_clean(p_job, 120), p_date, v_lines, round(v_sqm, 2), v_reason, v_photos,
            auth.uid(), coalesce(public.fca_my_name(), ''))
    returning * into v_row;
    return v_row;
  end if;

  if v_old.created_by is distinct from auth.uid() then
    raise exception 'Only the person who made this job can change it.';
  end if;
  v_changed := (v_old.kind, v_old.client, v_old.job, v_old.job_date, v_old.lines, v_old.reason, v_old.photos)
    is distinct from (p_kind, v_client, public.fca_clean(p_job, 120), p_date, v_lines, v_reason, v_photos);
  if not v_changed then return v_old; end if; -- sent twice: nothing to do
  update public.special_jobs set
    kind = p_kind, client = v_client, job = public.fca_clean(p_job, 120), job_date = p_date,
    lines = v_lines, sqm = round(v_sqm, 2), reason = v_reason, photos = v_photos, updated_at = now(),
    status = 'pending', decided_by = null, decided_by_name = '', decided_at = null, decide_note = ''
  where id = p_id
  returning * into v_row;
  return v_row;
end $$;

-- The person who made the job updates its job status from time to time (no new approval needed).
create or replace function public.update_special_stage(p_job uuid, p_stage text, p_note text, p_at timestamptz)
returns public.special_jobs
language plpgsql security definer set search_path = public as $$
declare
  v public.special_jobs;
  v_at timestamptz := least(coalesce(p_at, now()), now());
begin
  perform public.fca_require('special');
  if p_stage not in ('not_started', 'design', 'printing', 'finishing', 'ready', 'delivered') then raise exception 'Unknown job status.'; end if;
  select * into v from public.special_jobs where id = p_job for update;
  if not found then raise exception 'Job not found.'; end if;
  if v.created_by is distinct from auth.uid() then raise exception 'Only the person who made this job can update it.'; end if;
  -- the same update sent twice is saved once
  if exists (select 1 from jsonb_array_elements(v.updates) u where u ->> 'at' = to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) then return v; end if;
  update public.special_jobs set
    stage = p_stage,
    updates = updates || jsonb_build_object(
      'at', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'stage', p_stage, 'note', public.fca_clean(p_note, 300), 'by', coalesce(public.fca_my_name(), '')),
    updated_at = now()
  where id = p_job
  returning * into v;
  return v;
end $$;

-- Boss / Admin: approve or reject.
create or replace function public.decide_special_job(p_job uuid, p_approve boolean, p_note text)
returns public.special_jobs
language plpgsql security definer set search_path = public as $$
declare v public.special_jobs;
begin
  perform public.fca_require('approve_special');
  select * into v from public.special_jobs where id = p_job for update;
  if not found then raise exception 'Job not found.'; end if;
  if v.status <> 'pending' then
    if v.status = (case when p_approve then 'approved' else 'rejected' end) then return v; end if;
    raise exception 'This job was already %.', v.status;
  end if;
  if not p_approve and length(public.fca_clean(p_note, 300)) < 3 then raise exception 'Please write why it is rejected.'; end if;
  update public.special_jobs set
    status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_by_name = coalesce(public.fca_my_name(), ''), decided_at = now(),
    decide_note = public.fca_clean(p_note, 300)
  where id = p_job
  returning * into v;
  return v;
end $$;

-- Boss / Admin: tick Invoiced (with the invoice number) on an approved job.
create or replace function public.set_special_invoiced(p_job uuid, p_invoiced boolean, p_invoice_no text)
returns public.special_jobs
language plpgsql security definer set search_path = public as $$
declare v public.special_jobs;
begin
  perform public.fca_require('approve_special');
  select * into v from public.special_jobs where id = p_job for update;
  if not found then raise exception 'Job not found.'; end if;
  if v.status <> 'approved' then raise exception 'Only approved jobs can be marked invoiced.'; end if;
  update public.special_jobs set
    invoiced = p_invoiced,
    invoice_no = case when p_invoiced then public.fca_clean(p_invoice_no, 60) else '' end,
    invoiced_by_name = case when p_invoiced then coalesce(public.fca_my_name(), '') else '' end,
    invoiced_at = case when p_invoiced then now() else null end
  where id = p_job
  returning * into v;
  return v;
end $$;

-- The person who made a job can delete it while it is not approved.
create or replace function public.delete_special_job(p_job uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v public.special_jobs;
begin
  perform public.fca_require('special');
  select * into v from public.special_jobs where id = p_job for update;
  if not found then return; end if;
  if v.created_by is distinct from auth.uid() then raise exception 'Only the person who made this job can delete it.'; end if;
  if v.status = 'approved' then raise exception 'An approved job cannot be deleted.'; end if;
  delete from public.special_jobs where id = p_job;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'save_special_job(uuid, text, text, text, date, jsonb, text, jsonb)',
    'update_special_stage(uuid, text, text, timestamptz)',
    'decide_special_job(uuid, boolean, text)',
    'set_special_invoiced(uuid, boolean, text)',
    'delete_special_job(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Screenshots: a private storage bucket. People upload into their own folder
-- (<their user id>/...); they see their own pictures, the Boss and Admin see all.
do $$
begin
  if to_regclass('storage.objects') is null then return; end if; -- not on Supabase (tests)
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('special-jobs', 'special-jobs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

  drop policy if exists "special jobs: upload own screenshots" on storage.objects;
  create policy "special jobs: upload own screenshots" on storage.objects for insert to authenticated
    with check (bucket_id = 'special-jobs' and public.fca_can('special') and (storage.foldername(name))[1] = auth.uid()::text);

  drop policy if exists "special jobs: see screenshots" on storage.objects;
  create policy "special jobs: see screenshots" on storage.objects for select to authenticated
    using (bucket_id = 'special-jobs' and ((storage.foldername(name))[1] = auth.uid()::text or public.fca_can('approve_special')));

  drop policy if exists "special jobs: delete own screenshots" on storage.objects;
  create policy "special jobs: delete own screenshots" on storage.objects for delete to authenticated
    using (bucket_id = 'special-jobs' and (storage.foldername(name))[1] = auth.uid()::text);
end $$;
