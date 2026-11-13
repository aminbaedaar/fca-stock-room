-- New people who sign up start as Viewer (job calculator only).
-- The very first person still becomes Admin. The Admin can change roles on the Team page.
-- People already in the team keep their roles.

alter table public.members alter column role set default 'viewer';

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
    case when exists (select 1 from public.members where role = 'admin') then 'viewer'::public.fca_role else 'admin'::public.fca_role end
  )
  on conflict (user_id) do nothing;
  return new;
end $$;
