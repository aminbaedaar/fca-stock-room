-- FCA Stock Room: row-level security.
-- Signed-in team members can read. Nobody can insert, update or delete rows
-- directly: changes go through the checked functions in 0002_functions.sql.
-- The server functions (AI assistant, Monday summary) use the service role.

alter table public.members enable row level security;
alter table public.items enable row level security;
alter table public.counts enable row level security;
alter table public.moves enable row level security;
alter table public.requests enable row level security;
alter table public.reports enable row level security;
alter table public.stock_takes enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.ai_usage enable row level security;

create policy "team can read members" on public.members for select to authenticated using (public.fca_can('view'));
create policy "team can read items" on public.items for select to authenticated using (public.fca_can('view'));
create policy "team can read counts" on public.counts for select to authenticated using (public.fca_can('view'));
create policy "team can read moves" on public.moves for select to authenticated using (public.fca_can('view'));
create policy "team can read requests" on public.requests for select to authenticated using (public.fca_can('view'));
create policy "team can read reports" on public.reports for select to authenticated using (public.fca_can('view'));
create policy "team can read stock takes" on public.stock_takes for select to authenticated using (public.fca_can('view'));

-- Each person manages their own push subscriptions.
create policy "own push subscriptions read" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "own push subscriptions add" on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy "own push subscriptions update" on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own push subscriptions remove" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- ai_usage: no policies, so only the server (service role) can touch it.

-- Belt and braces: no direct writes for API roles on data tables.
revoke insert, update, delete on public.members, public.items, public.counts, public.moves,
  public.requests, public.reports, public.stock_takes, public.ai_usage from anon, authenticated;
revoke all on all tables in schema public from anon;
