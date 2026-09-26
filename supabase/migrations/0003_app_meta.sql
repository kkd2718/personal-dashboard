-- Phase 2b: generic key/value metadata store (telegram digest idempotency, etc).
-- Idempotent: safe to re-run (scripts/migrate.mjs also tracks applied files in _migrations).

create table if not exists app_meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_meta enable row level security;
revoke all on app_meta from anon, authenticated;
