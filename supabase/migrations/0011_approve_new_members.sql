-- New accounts wait for the Admin.
-- Anyone who creates an account can sign in, but sees only a "waiting for
-- approval" screen and can read or change nothing, until the Admin approves
-- them on the Team page. The Admin can also block someone later.
-- People already in the team stay approved. The very first user is the Admin
-- and is approved straight away.

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'members' and column_name = 'approved') then
    alter table public.members add column approved boolean not null default false;
    update public.members set approved = true; -- only the first time: today's team stays in
  end if;
end $$;

-- Every permission check goes through this, so a person who is not approved
-- has no rights anywhere (tables, functions, screenshot storage).
create or replace function public.fca_my_role() returns public.fca_role
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid() and approved
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_first boolean;
begin
  perform pg_advisory_xact_lock(724001); -- so only one "first user" becomes admin
  v_first := not exists (select 1 from public.members where role = 'admin');
  insert into public.members (user_id, name, email, photo, role, approved)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', ''),
    case when v_first then 'admin'::public.fca_role else 'viewer'::public.fca_role end,
    v_first
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

-- Admin approves (true) or blocks (false) a person.
create or replace function public.approve_member(p_user uuid, p_approve boolean)
returns public.members
language plpgsql security definer set search_path = public as $$
declare v public.members;
begin
  perform public.fca_require('roles');
  perform pg_advisory_xact_lock(724001);
  if not p_approve and p_user = auth.uid() then
    raise exception 'You cannot block yourself.';
  end if;
  if not p_approve
     and (select role from public.members where user_id = p_user) = 'admin'
     and (select count(*) from public.members where role = 'admin' and approved) <= 1 then
    raise exception 'There must always be at least one Admin.';
  end if;
  update public.members set approved = p_approve where user_id = p_user returning * into v;
  if not found then raise exception 'User not found.'; end if;
  return v;
end $$;

revoke all on function public.approve_member(uuid, boolean) from public, anon;
grant execute on function public.approve_member(uuid, boolean) to authenticated;
