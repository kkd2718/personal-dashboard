-- Phase 3: Google Calendar events, Gmail review-candidate detection, Obsidian
-- import idempotency. Idempotent: safe to re-run (scripts/migrate.mjs also
-- tracks applied files in _migrations).

create table if not exists calendar_events (
  id text primary key, -- '<account>:<calendarId>:<eventId>'
  account text not null,
  calendar_name text not null,
  title text not null,
  start_date date not null,
  end_date date not null, -- inclusive, KST
  start_time text, -- 'HH:mm' KST; null = all-day
  end_time text,
  location text,
  updated_at timestamptz not null default now()
);
create index if not exists calendar_events_account_idx on calendar_events(account);
create index if not exists calendar_events_range_idx on calendar_events(start_date, end_date);

create table if not exists review_candidates (
  id text primary key, -- 'rc-<gmail messageId>'
  account text not null,
  message_id text not null unique,
  received_at timestamptz not null,
  from_addr text not null,
  subject text not null,
  snippet text not null,
  kind text not null, -- invitation|reminder|confirmation|other
  journal text,
  manuscript_id text,
  title text,
  due_date date,
  link text,
  status text not null default 'pending', -- pending|accepted|dismissed
  review_id text references review_jobs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists review_candidates_status_idx on review_candidates(status);

alter table notes add column if not exists external_id text unique;

do $$
declare
  t text;
begin
  for t in select unnest(array['calendar_events', 'review_candidates']) loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- Deletes an account's events overlapping [p_from, p_to] and inserts the replacement
-- set, atomically (used by POST /api/google/sync).
create or replace function replace_calendar_events(
  p_account text,
  p_from date,
  p_to date,
  p_events jsonb, -- array of calendar_events rows (camel keys mapped by caller to snake in jsonb)
  p_now timestamptz
) returns void
language plpgsql
security definer
as $$
begin
  delete from calendar_events
  where account = p_account and start_date <= p_to and end_date >= p_from;

  -- p_events: jsonb array of calendar_events rows in snake_case (as produced by
  -- lib/repo/mappers.ts's calendarEventToRow).
  insert into calendar_events (id, account, calendar_name, title, start_date, end_date, start_time, end_time, location, updated_at)
  select
    e->>'id', e->>'account', e->>'calendar_name', e->>'title',
    (e->>'start_date')::date, (e->>'end_date')::date,
    e->>'start_time', e->>'end_time', e->>'location', p_now
  from jsonb_array_elements(p_events) as e;
end;
$$;

revoke all on function replace_calendar_events from anon, authenticated;
