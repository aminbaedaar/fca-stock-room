-- Weekly Monday summary at 07:37 Africa/Kigali (= 05:37 UTC).
-- Run this ONCE in the Supabase SQL editor after deploying the functions.
-- Replace the two values in angle brackets first (see docs/SETUP.md, step 6).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'fca-monday-summary',
  '37 5 * * 1',
  $$
  select net.http_post(
    url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/monday-summary',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<YOUR-CRON-SECRET>'),
    body := '{"source":"scheduled"}'::jsonb
  );
  $$
);

-- To check it is scheduled:   select * from cron.job;
-- To remove it:               select cron.unschedule('fca-monday-summary');
