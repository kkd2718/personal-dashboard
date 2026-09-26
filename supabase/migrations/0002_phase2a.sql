-- Phase 2a: PC collector backlog metrics + agent inbox delivery tracking.
-- Idempotent: safe to re-run (scripts/migrate.mjs also tracks applied files in _migrations).

alter table projects add column if not exists backlog_globs jsonb not null default '[]';
alter table tasks add column if not exists delivered_at timestamptz;

-- Amgi's BACKLOG.md lives at the repo root; the collector reads it as a glob
-- relative to the project path. Other projects default to [] (edit via the UI).
update projects set backlog_globs = '["docs/BACKLOG.md"]'::jsonb where id = 'p-amgi';
