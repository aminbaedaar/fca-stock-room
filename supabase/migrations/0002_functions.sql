-- FCA Stock Room: permission checks and every function that changes data.
-- All are SECURITY DEFINER: they run with full rights but check the caller's
-- role first, so the rules hold even if someone calls the API directly.

-- ---------------------------------------------------------------- helpers

create or replace function public.fca_my_role() returns public.fca_role
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid()
$$;

-- Must match packages/core/src/roles.ts (a test checks this).
create or replace function public.fca_can(perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.fca_my_role()::text = any (
    case perm
      -- PERMISSIONS START
      when 'view' then array['admin', 'boss', 'manager', 'staff', 'viewer']
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

create or replace function public.fca_require(perm text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.fca_can(perm) then
    raise exception 'Your role is not allowed to do this (%).', perm using errcode = '42501';
  end if;
end $$;

create or replace function public.fca_my_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(name, ''), email, '') from public.members where user_id = auth.uid()
$$;

create or replace function public.fca_label(i public.items) returns text
language sql immutable as $$
  select i.name || case when i.size <> '' then ' ' || i.size else '' end
$$;

-- A stable id derived from a parent id, used for the per-item rows of a batch.
create or replace function public.fca_sub_id(parent uuid, part text) returns uuid
language sql immutable as $$
  select md5(parent::text || ':' || part)::uuid
$$;

create or replace function public.fca_clean(t text, max_len int) returns text
language sql immutable as $$
  select left(coalesce(btrim(t), ''), max_len)
$$;

-- ---------------------------------------------------------------- members

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(724001); -- so only one "first user" becomes admin
  insert into public.members (user_id, name, email, photo, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', ''),
    case when exists (select 1 from public.members where role = 'admin') then 'staff'::public.fca_role else 'admin'::public.fca_role end
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_member(p_name text default null, p_photo text default null)
returns public.members
language plpgsql security definer set search_path = public as $$
declare v public.members;
begin
  update public.members set
    last_seen = now(),
    name = coalesce(nullif(public.fca_clean(p_name, 80), ''), name),
    photo = coalesce(nullif(public.fca_clean(p_photo, 500), ''), photo)
  where user_id = auth.uid()
  returning * into v;
  return v;
end $$;

create or replace function public.set_role(p_user uuid, p_role public.fca_role)
returns public.members
language plpgsql security definer set search_path = public as $$
declare v public.members;
begin
  perform public.fca_require('roles');
  perform pg_advisory_xact_lock(724001);
  if p_role <> 'admin'
     and (select role from public.members where user_id = p_user) = 'admin'
     and (select count(*) from public.members where role = 'admin') <= 1 then
    raise exception 'There must always be at least one Admin.';
  end if;
  update public.members set role = p_role where user_id = p_user returning * into v;
  if not found then raise exception 'User not found.'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- stock moves

-- Internal: changes stock and logs the movement. No permission check, so it
-- is not callable from the API (see grants at the end).
create or replace function public.fca_apply_move(
  p_id uuid, p_item uuid, p_type text, p_delta numeric, p_metres numeric,
  p_client text, p_job text, p_note text, p_at timestamptz
) returns public.moves
language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_move public.moves;
begin
  select * into v_move from public.moves where id = p_id;
  if found then return v_move; end if; -- already saved (e.g. offline retry)

  select * into v_item from public.items where id = p_item and active for update;
  if not found then raise exception 'Item not found.'; end if;
  if v_item.qty + p_delta < 0 then
    raise exception 'Not enough stock: only % % of % left.', trim_scale(v_item.qty), v_item.unit, public.fca_label(v_item);
  end if;

  update public.items set qty = qty + p_delta, updated_at = now() where id = p_item returning * into v_item;

  insert into public.moves (id, at, type, item_id, item_name, unit, delta, metres, balance, client, job, note, user_id, user_name)
  values (
    p_id, least(coalesce(p_at, now()), now()), p_type, p_item, public.fca_label(v_item), v_item.unit,
    p_delta, p_metres, v_item.qty,
    public.fca_clean(p_client, 120), public.fca_clean(p_job, 120), public.fca_clean(p_note, 500),
    auth.uid(), coalesce(public.fca_my_name(), '')
  )
  returning * into v_move;
  return v_move;
end $$;

-- Stock in, stock out or adjust. p_qty is positive for in/out; for adjust it
-- is the signed change. p_at lets an offline change keep the time it was made.
create or replace function public.record_move(
  p_id uuid, p_item uuid, p_type text, p_qty numeric,
  p_metres numeric default null, p_client text default '', p_job text default '',
  p_note text default '', p_at timestamptz default null
) returns public.moves
language plpgsql security definer set search_path = public as $$
declare v_move public.moves;
begin
  select * into v_move from public.moves where id = p_id;
  if found then return v_move; end if;

  if p_type in ('in', 'out') then
    perform public.fca_require('stock');
    if p_qty is null or p_qty <= 0 then raise exception 'Enter a quantity above 0.'; end if;
  elsif p_type = 'adjust' then
    perform public.fca_require('adjust');
    if p_qty is null or p_qty = 0 then raise exception 'Enter a change other than 0.'; end if;
    if coalesce(btrim(p_note), '') = '' then raise exception 'Please give a reason for the adjustment.'; end if;
  else
    raise exception 'Unknown movement type: %', p_type;
  end if;

  return public.fca_apply_move(
    p_id, p_item, p_type,
    case when p_type = 'out' then -p_qty else p_qty end,
    p_metres, p_client, p_job, p_note, p_at
  );
end $$;

-- Weekly stock take: records a count for every item listed and logs a
-- 'count' movement for each item whose stock changed.
-- p_counts: [{"item_id": "...", "qty": 12}, ...]
create or replace function public.save_stock_take(p_id uuid, p_date date, p_counts jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_item public.items;
  v_qty numeric;
  v_changed integer := 0;
begin
  perform public.fca_require('stocktake');
  if exists (select 1 from public.stock_takes where id = p_id) then
    return (select changed from public.stock_takes where id = p_id);
  end if;
  if p_date > (now() at time zone 'Africa/Kigali')::date then raise exception 'Stock take date cannot be in the future.'; end if;

  for v_row in select * from jsonb_array_elements(p_counts) loop
    v_qty := (v_row ->> 'qty')::numeric;
    if v_qty is null or v_qty < 0 then raise exception 'Counts must be 0 or more.'; end if;

    select * into v_item from public.items where id = (v_row ->> 'item_id')::uuid and active for update;
    if not found then continue; end if;

    insert into public.counts (item_id, date, qty) values (v_item.id, p_date, v_qty)
    on conflict (item_id, date) do update set qty = excluded.qty;

    if v_qty <> v_item.qty then
      update public.items set qty = v_qty, updated_at = now() where id = v_item.id;
      insert into public.moves (id, type, item_id, item_name, unit, delta, balance, note, user_id, user_name)
      values (
        public.fca_sub_id(p_id, v_item.id::text), 'count', v_item.id, public.fca_label(v_item), v_item.unit,
        v_qty - v_item.qty, v_qty, 'Stock take ' || to_char(p_date, 'FMDD Mon YYYY'),
        auth.uid(), coalesce(public.fca_my_name(), '')
      );
      v_changed := v_changed + 1;
    end if;
  end loop;

  insert into public.stock_takes (id, date, changed, user_id) values (p_id, p_date, v_changed, auth.uid());
  return v_changed;
end $$;

-- Admin only: reverse a movement. The original stays in the log, crossed out.
create or replace function public.void_move(p_id uuid, p_move uuid)
returns public.moves
language plpgsql security definer set search_path = public as $$
declare
  v_orig public.moves;
  v_item public.items;
  v_move public.moves;
begin
  perform public.fca_require('void');
  select * into v_move from public.moves where id = p_id;
  if found then return v_move; end if;

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
    'Reversed ' || v_orig.type || ' of ' || to_char(v_orig.at at time zone 'Africa/Kigali', 'FMDD Mon YYYY HH24:MI'),
    auth.uid(), coalesce(public.fca_my_name(), ''), p_move
  )
  returning * into v_move;
  return v_move;
end $$;

-- ---------------------------------------------------------------- items

-- Create (p_item_id null) or edit an item. Quantity is only set on create;
-- after that it changes through movements.
create or replace function public.upsert_item(
  p_id uuid, p_item_id uuid, p_name text, p_size text, p_category text, p_unit text,
  p_min numeric, p_note text, p_qty numeric default 0, p_sort integer default null
) returns public.items
language plpgsql security definer set search_path = public as $$
declare
  v_old public.items;
  v_item public.items;
  v_changes text[] := '{}';
begin
  perform public.fca_require('items');
  if exists (select 1 from public.moves where id = p_id) then
    return (select i from public.items i where i.id = (select item_id from public.moves where id = p_id));
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Item name is required.'; end if;
  if coalesce(p_min, 0) < 0 or coalesce(p_qty, 0) < 0 then raise exception 'Numbers must be 0 or more.'; end if;

  if p_item_id is null then
    insert into public.items (name, size, category, unit, qty, min_level, note, sort)
    values (
      upper(public.fca_clean(p_name, 120)), upper(public.fca_clean(p_size, 40)), p_category, p_unit,
      coalesce(p_qty, 0), coalesce(p_min, 0), public.fca_clean(p_note, 500),
      coalesce(p_sort, (select coalesce(max(sort), 0) + 1 from public.items))
    )
    returning * into v_item;
    insert into public.moves (id, type, item_id, item_name, unit, delta, balance, note, user_id, user_name)
    values (p_id, 'created', v_item.id, public.fca_label(v_item), v_item.unit, v_item.qty, v_item.qty, 'Item added', auth.uid(), coalesce(public.fca_my_name(), ''));
    return v_item;
  end if;

  select * into v_old from public.items where id = p_item_id and active for update;
  if not found then raise exception 'Item not found.'; end if;

  update public.items set
    name = upper(public.fca_clean(p_name, 120)),
    size = upper(public.fca_clean(p_size, 40)),
    category = p_category,
    unit = p_unit,
    min_level = coalesce(p_min, 0),
    note = public.fca_clean(p_note, 500),
    sort = coalesce(p_sort, sort),
    updated_at = now()
  where id = p_item_id
  returning * into v_item;

  if v_old.name <> v_item.name then v_changes := array_append(v_changes, 'name ' || v_old.name || ' → ' || v_item.name); end if;
  if v_old.size <> v_item.size then v_changes := array_append(v_changes, 'size ' || v_old.size || ' → ' || v_item.size); end if;
  if v_old.category <> v_item.category then v_changes := array_append(v_changes, 'category → ' || v_item.category); end if;
  if v_old.unit <> v_item.unit then v_changes := array_append(v_changes, 'unit ' || v_old.unit || ' → ' || v_item.unit); end if;
  if v_old.min_level <> v_item.min_level then v_changes := array_append(v_changes, 'minimum ' || trim_scale(v_old.min_level) || ' → ' || trim_scale(v_item.min_level)); end if;
  if v_old.note <> v_item.note then v_changes := array_append(v_changes, 'note'); end if;

  insert into public.moves (id, type, item_id, item_name, unit, delta, balance, note, user_id, user_name)
  values (p_id, 'edit', v_item.id, public.fca_label(v_item), v_item.unit, 0, v_item.qty,
          left('Edited: ' || coalesce(nullif(array_to_string(v_changes, '; '), ''), 'no changes'), 500),
          auth.uid(), coalesce(public.fca_my_name(), ''));
  return v_item;
end $$;

create or replace function public.remove_item(p_id uuid, p_item uuid, p_reason text default '')
returns public.items
language plpgsql security definer set search_path = public as $$
declare v_item public.items;
begin
  perform public.fca_require('items');
  if exists (select 1 from public.moves where id = p_id) then
    return (select i from public.items i where i.id = p_item);
  end if;
  update public.items set active = false, updated_at = now() where id = p_item and active returning * into v_item;
  if not found then raise exception 'Item not found.'; end if;
  insert into public.moves (id, type, item_id, item_name, unit, delta, balance, note, user_id, user_name)
  values (p_id, 'removed', v_item.id, public.fca_label(v_item), v_item.unit, 0, v_item.qty,
          coalesce(nullif(public.fca_clean(p_reason, 500), ''), 'Item removed'), auth.uid(), coalesce(public.fca_my_name(), ''));
  return v_item;
end $$;

-- Admin only: add items (with count history) from the Excel import screen.
-- Items that already exist (same name + size) only get their history merged.
-- p_items: [{"name","size","category","unit","qty","min_level","note","counts":[{"date","qty"}]}]
create or replace function public.import_items(p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_c jsonb;
  v_item public.items;
  v_added int := 0;
  v_merged int := 0;
  v_sort int;
begin
  perform public.fca_require('import');
  select coalesce(max(sort), 0) into v_sort from public.items;

  for v_row in select * from jsonb_array_elements(p_items) loop
    select * into v_item from public.items
     where active and name = upper(btrim(v_row ->> 'name')) and size = upper(coalesce(btrim(v_row ->> 'size'), ''));
    if found then
      v_merged := v_merged + 1;
    else
      v_sort := v_sort + 1;
      insert into public.items (name, size, category, unit, qty, min_level, note, sort)
      values (
        upper(public.fca_clean(v_row ->> 'name', 120)), upper(public.fca_clean(v_row ->> 'size', 40)),
        v_row ->> 'category', v_row ->> 'unit',
        coalesce((v_row ->> 'qty')::numeric, 0), coalesce((v_row ->> 'min_level')::numeric, 0),
        public.fca_clean(v_row ->> 'note', 500), v_sort
      )
      returning * into v_item;
      insert into public.moves (id, type, item_id, item_name, unit, delta, balance, note, user_id, user_name)
      values (gen_random_uuid(), 'created', v_item.id, public.fca_label(v_item), v_item.unit, v_item.qty, v_item.qty,
              'Imported from Excel', auth.uid(), coalesce(public.fca_my_name(), ''));
      v_added := v_added + 1;
    end if;

    for v_c in select * from jsonb_array_elements(coalesce(v_row -> 'counts', '[]'::jsonb)) loop
      insert into public.counts (item_id, date, qty)
      values (v_item.id, (v_c ->> 'date')::date, (v_c ->> 'qty')::numeric)
      on conflict (item_id, date) do nothing;
    end loop;
  end loop;

  return jsonb_build_object('added', v_added, 'merged', v_merged);
end $$;

-- ---------------------------------------------------------------- requests

create or replace function public.create_request(
  p_id uuid, p_item uuid, p_qty numeric, p_client text default '', p_job text default '', p_note text default ''
) returns public.requests
language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_req public.requests;
begin
  perform public.fca_require('request');
  select * into v_req from public.requests where id = p_id;
  if found then return v_req; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter a quantity above 0.'; end if;
  select * into v_item from public.items where id = p_item and active;
  if not found then raise exception 'Item not found.'; end if;

  insert into public.requests (id, item_id, item_name, qty, unit, client, job, note, requested_by, requested_by_name)
  values (p_id, p_item, public.fca_label(v_item), p_qty, v_item.unit,
          public.fca_clean(p_client, 120), public.fca_clean(p_job, 120), public.fca_clean(p_note, 500),
          auth.uid(), coalesce(public.fca_my_name(), ''))
  returning * into v_req;
  return v_req;
end $$;

-- Approving creates the stock-out movement (id = p_id).
create or replace function public.decide_request(p_id uuid, p_request uuid, p_approve boolean)
returns public.requests
language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests;
  v_move public.moves;
begin
  perform public.fca_require('approve');
  select * into v_req from public.requests where id = p_request for update;
  if not found then raise exception 'Request not found.'; end if;
  if v_req.status <> 'pending' then
    if v_req.move_id = p_id or (v_req.status = 'rejected' and not p_approve) then return v_req; end if;
    raise exception 'This request was already %.', v_req.status;
  end if;

  if p_approve then
    v_move := public.fca_apply_move(
      p_id, v_req.item_id, 'out', -v_req.qty, null, v_req.client, v_req.job,
      'Request by ' || v_req.requested_by_name || case when v_req.note <> '' then ': ' || v_req.note else '' end,
      null
    );
  end if;

  update public.requests set
    status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(),
    decided_by_name = coalesce(public.fca_my_name(), ''),
    decided_at = now(),
    move_id = v_move.id
  where id = p_request
  returning * into v_req;
  return v_req;
end $$;

-- ---------------------------------------------------------------- grants

revoke all on function public.fca_apply_move(uuid, uuid, text, numeric, numeric, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'touch_member(text, text)', 'set_role(uuid, public.fca_role)',
    'record_move(uuid, uuid, text, numeric, numeric, text, text, text, timestamptz)',
    'save_stock_take(uuid, date, jsonb)', 'void_move(uuid, uuid)',
    'upsert_item(uuid, uuid, text, text, text, text, numeric, text, numeric, integer)',
    'remove_item(uuid, uuid, text)', 'import_items(jsonb)',
    'create_request(uuid, uuid, numeric, text, text, text)', 'decide_request(uuid, uuid, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
