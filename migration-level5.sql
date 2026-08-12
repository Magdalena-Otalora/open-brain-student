-- Run this ONE TIME in your Supabase SQL editor.
-- How to get there: supabase.com → your project → SQL Editor → New query → paste everything below → click Run

-- Add enrichment columns to thoughts
alter table thoughts
  add column if not exists tags text[] default '{}',
  add column if not exists category text,
  add column if not exists summary text,
  add column if not exists enriched_at timestamptz;

-- Enable pg_cron (only needs to run once per project)
create extension if not exists pg_cron;
grant usage on schema cron to postgres;

-- Schedule the weekly digest every Sunday at 8am UTC
select cron.schedule(
  'weekly-brain-digest',
  '0 8 * * 0',
  $$
    select net.http_post(
      url := 'https://fakxdsqjkrjjwbjiogbe.supabase.co/functions/v1/weekly-digest',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);

-- Database Webhook (created via Supabase Dashboard → Integrations → Database Webhooks, not SQL):
--   Name: enrich-on-insert
--   Table: thoughts
--   Events: INSERT
--   Type: Supabase Edge Functions → enrich-thought
