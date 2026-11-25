-- Catch-up: parts of 0006 and 0007 that never reached the live database.
-- 1. Viewers (and everyone who can use the calculator) can read the materials list.
-- 2. Only the Admin sees the team list; everyone else reads just their own record.
-- 3. Reverse a movement needs a reason (void_move with p_reason).
-- Safe to run more than once. Does not touch the permission list (fca_can).

drop policy if exists "team can read sqm materials" on public.sqm_materials;
drop policy if exists "calculator users can read sqm materials" on public.sqm_materials;
create policy "calculator users can read sqm materials" on public.sqm_materials
  for select to authenticated using (public.fca_can('calculator'));

drop policy if exists "team can read members" on public.members;
drop policy if exists "admin reads team, others read themselves" on public.members;
create policy "admin reads team, others read themselves" on public.members
  for select to authenticated using (public.fca_can('roles') or user_id = auth.uid());


-- Reverse a movement: now needs a reason, which is saved on the Reversed line.
drop function if exists public.void_move(uuid, uuid);
create or replace function public.void_move(p_id uuid, p_move uuid, p_reason text)
returns public.moves
language plpgsql security definer set search_path = public as $$
declare
  v_orig public.moves;
  v_item public.items;
  v_move public.moves;
  v_reason text := public.fca_clean(p_reason, 300);
begin
  perform public.fca_require('void');
  select * into v_move from public.moves where id = p_id;
  if found then return v_move; end if;
  if length(coalesce(v_reason, '')) < 3 then raise exception 'Write the reason for reversing this movement.'; end if;

  select * into v_orig from public.moves where id = p_move for update;
  if not found then raise exception 'Movement not found.'; end if;
  if v_orig.voided then raise exception 'This movement is already reversed.'; end if;
  if v_orig.type not in ('in', 'out', 'adjust', 'count') then
    raise exception 'Only stock in, out, adjust and count movements can be reversed.';
  end if;

  select * into v_item from public.items where id = v_orig.item_id for update;
  if v_item.qty - v_orig.delta < 0 then
    raise exception 'Cannot reverse: stock would go below 0 (% % left).', trim_scale(v_item.qty), v_item.unit;
  end if;

  update public.items set qty = qty - v_orig.delta, updated_at = now() where id = v_item.id returning * into v_item;
  update public.moves set voided = true, voided_by = auth.uid(), voided_at = now() where id = p_move;

  insert into public.moves (id, type, item_id, item_name, unit, delta, balance, client, job, note, user_id, user_name, void_of)
  values (
    p_id, 'void', v_item.id, public.fca_label(v_item), v_item.unit, -v_orig.delta, v_item.qty,
    v_orig.client, v_orig.job,
    'Reversed ' || v_orig.type || ' of ' || to_char(v_orig.at at time zone 'Africa/Kigali', 'FMDD Mon YYYY HH24:MI') || '. Reason: ' || v_reason,
    auth.uid(), coalesce(public.fca_my_name(), ''), p_move
  )
  returning * into v_move;
  return v_move;
end $$;

revoke all on function public.void_move(uuid, uuid, text) from public, anon;
grant execute on function public.void_move(uuid, uuid, text) to authenticated;
