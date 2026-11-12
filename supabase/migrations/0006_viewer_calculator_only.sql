-- Viewers use only the job calculator: they can read its materials list,
-- but not stock, movements, requests, reports or the team list.
-- (Replaces the separate "Calculator only" role: anyone given it becomes a Viewer.)
-- Run once in the Supabase SQL Editor. Works whether or not 0005 was run.

-- Must match packages/core/src/roles.ts (a test checks this).
create or replace function public.fca_can(perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.fca_my_role()::text = any (
    case perm
      -- PERMISSIONS START
      when 'view' then array['admin', 'boss', 'manager', 'staff']
      when 'calculator' then array['admin', 'boss', 'manager', 'staff', 'viewer']
      when 'request' then array['admin', 'boss', 'manager', 'staff']
      when 'stock' then array['admin', 'boss', 'manager', 'staff']
      when 'adjust' then array['admin', 'boss', 'manager']
      when 'items' then array['admin', 'boss', 'manager']
      when 'approve' then array['admin', 'boss', 'manager']
      when 'stocktake' then array['admin', 'boss', 'manager']
      when 'summary' then array['admin', 'boss', 'manager']
      when 'import' then array['admin']
      when 'void' then array['admin']
      when 'roles' then array['admin']
      when 'backup' then array['admin']
      -- PERMISSIONS END
      else array[]::text[]
    end
  ), false)
$$;

update public.members set role = 'viewer' where role::text = 'calculator';

drop policy if exists "team can read sqm materials" on public.sqm_materials;
drop policy if exists "calculator users can read sqm materials" on public.sqm_materials;
create policy "calculator users can read sqm materials" on public.sqm_materials
  for select to authenticated using (public.fca_can('calculator'));
