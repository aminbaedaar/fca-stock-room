-- Complimentary / no sales order jobs: deleting keeps the job.
-- A delete needs a reason; the job stays with all its details, marked Deleted
-- with who deleted it, when and why. A deleted job cannot be changed again.
-- Run once in the Supabase SQL Editor, after 0009_special_jobs.sql.

alter table public.special_jobs
  add column if not exists deleted         boolean not null default false,
  add column if not exists deleted_at      timestamptz,
  add column if not exists deleted_by_name text not null default '',
  add column if not exists delete_reason   text not null default '' check (length(delete_reason) <= 300);

-- Nothing may change a deleted job (approve, invoice, edit, job status).
create or replace function public.special_jobs_keep_deleted() returns trigger
language plpgsql as $$
begin
  if old.deleted then raise exception 'This job was deleted and cannot be changed.'; end if;
  return new;
end $$;
drop trigger if exists special_jobs_keep_deleted on public.special_jobs;
create trigger special_jobs_keep_deleted before update or delete on public.special_jobs
  for each row execute function public.special_jobs_keep_deleted();

-- The person who made the job deletes it (not once approved), with a reason.
drop function if exists public.delete_special_job(uuid);
create or replace function public.delete_special_job(p_job uuid, p_reason text)
returns public.special_jobs
language plpgsql security definer set search_path = public as $$
declare
  v public.special_jobs;
  v_reason text := public.fca_clean(p_reason, 300);
begin
  perform public.fca_require('special');
  select * into v from public.special_jobs where id = p_job for update;
  if not found then raise exception 'Job not found.'; end if;
  if v.created_by is distinct from auth.uid() then raise exception 'Only the person who made this job can delete it.'; end if;
  if v.deleted then return v; end if; -- sent twice
  if v.status = 'approved' then raise exception 'An approved job cannot be deleted.'; end if;
  if length(v_reason) < 3 then raise exception 'Please write why the job is deleted.'; end if;
  update public.special_jobs set
    deleted = true, deleted_at = now(), deleted_by_name = coalesce(public.fca_my_name(), ''), delete_reason = v_reason
  where id = p_job
  returning * into v;
  return v;
end $$;

revoke all on function public.delete_special_job(uuid, text) from public, anon;
grant execute on function public.delete_special_job(uuid, text) to authenticated;
