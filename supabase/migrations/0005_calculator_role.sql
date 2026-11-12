-- "Calculator only" role: can use the job calculator (and read its shared
-- materials list) but cannot see stock, movements, requests, reports or the team.
-- Run once in the Supabase SQL Editor, after 0004_sqm.sql.

alter type public.fca_role add value if not exists 'calculator';

-- Must match packages/core/src/roles.ts (a test checks this).
-- Roles are compared as text, so this works in the same run as the line above.
create or replace function public.fca_can(perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.fca_my_role()::text = any (
    case perm
      -- PERMISSIONS START
      when 'view' then array['admin', 'boss', 'manager', 'staff', 'viewer']
      when 'calculator' then array['admin', 'boss', 'manager', 'staff', 'viewer', 'calculator']
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

-- The calculator's materials list is readable by everyone who can use the calculator.
drop policy if exists "team can read sqm materials" on public.sqm_materials;
create policy "calculator users can read sqm materials" on public.sqm_materials
  for select to authenticated using (public.fca_can('calculator'));
