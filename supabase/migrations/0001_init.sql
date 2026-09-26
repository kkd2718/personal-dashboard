-- Phase 1b schema. Single-user app: RLS enabled on every table with NO policies
-- (anon and authenticated are both denied everything); all access goes through
-- the service-role key from server code. See docs/reviews/plan-advice.md §5.
-- Idempotent: safe to re-run (scripts/migrate.mjs also tracks applied files in _migrations).

create table if not exists projects (
  id text primary key,
  slug text not null unique,
  name text not null,
  "group" text not null,
  subgroup text,
  status text not null,
  summary text not null default '',
  next_action text,
  links jsonb not null default '[]',
  paths jsonb not null default '[]',
  aliases jsonb not null default '[]',
  pinned boolean not null default false,
  sort integer not null default 0,
  color text not null default 'blue',
  updated_at timestamptz not null default now()
);

create table if not exists milestones (
  id text primary key,
  project_id text not null references projects(id),
  title text not null,
  start_date date,
  end_date date,
  status text not null,
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id text primary key,
  project_id text references projects(id),
  milestone_id text references milestones(id),
  title text not null,
  description text,
  status text not null,
  due_date date,
  done_at timestamptz,
  assignee text not null default 'me',
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notes (
  id text primary key,
  body text not null,
  kind text not null,
  status text not null,
  project_id text references projects(id),
  tags jsonb not null default '[]',
  date date,
  pinned boolean not null default false,
  source text not null,
  delivered_at timestamptz,
  task_id text references tasks(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists papers (
  id text primary key,
  title text not null,
  short_name text not null,
  stage text not null,
  track text not null,
  journal text,
  manuscript_id text,
  target_journals jsonb not null default '[]',
  folder_path text,
  next_action text,
  project_id text references projects(id),
  submissions jsonb not null default '[]',
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists review_jobs (
  id text primary key,
  journal text not null,
  manuscript_id text,
  title text,
  status text not null,
  invited_at timestamptz,
  due_date date,
  link text,
  note text,
  updated_at timestamptz not null default now()
);

create table if not exists deadlines (
  id text primary key,
  title text not null,
  kind text not null,
  due_date date not null,
  due_time text,
  project_id text references projects(id),
  paper_id text references papers(id),
  review_id text references review_jobs(id),
  done boolean not null default false,
  remind_days jsonb not null default '[7,3,1]',
  updated_at timestamptz not null default now()
);

-- Machine-written telemetry (phase 2 collector), one row per project, upserted wholesale.
create table if not exists project_activity (
  project_id text primary key references projects(id),
  branch text,
  last_commit_at timestamptz,
  last_commit_msg text,
  dirty boolean,
  last_session_at timestamptz,
  memory_digest text,
  metrics jsonb not null default '{}',
  collected_at timestamptz not null default now()
);

-- Cloud status panel cache, written by POST /api/ingest, read when LOCAL_PROBES is off.
create table if not exists status_snapshot (
  id text primary key default 'latest',
  items jsonb not null default '[]',
  collected_at timestamptz not null default now()
);

-- Daily cron heartbeat.
create table if not exists heartbeat (
  id integer primary key default 1,
  at timestamptz not null default now()
);

create table if not exists _migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);

-- RLS: enabled everywhere, no policies (deny-all for anon/authenticated). Server
-- code uses the service-role key, which bypasses RLS entirely.
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'projects', 'milestones', 'tasks', 'notes', 'papers', 'review_jobs',
      'deadlines', 'project_activity', 'status_snapshot', 'heartbeat', '_migrations'
    ])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- --- RPCs for multi-row atomic operations (SECURITY DEFINER: bypasses RLS; the
-- server only calls these with the service-role client, never exposed to anon). ---

create or replace function convert_note_to_task(
  p_task_id text,
  p_project_id text,
  p_milestone_id text,
  p_title text,
  p_description text,
  p_due_date date,
  p_now timestamptz,
  p_note_id text
) returns void
language plpgsql
security definer
as $$
begin
  insert into tasks (id, project_id, milestone_id, title, description, status, due_date, done_at, assignee, sort, created_at, updated_at)
  values (
    p_task_id, p_project_id, p_milestone_id, p_title, p_description, 'todo', p_due_date, null, 'me',
    (select coalesce(max(sort) + 1, 0) from tasks where project_id = p_project_id and status = 'todo'),
    p_now, p_now
  );
  update notes set status = 'done', task_id = p_task_id, updated_at = p_now where id = p_note_id;
end;
$$;

-- Renames tag `p_from` to `p_to` across every note (or merges into it if `p_to`
-- already exists on that note), case-insensitively, deduping the result.
create or replace function merge_tag(p_from text, p_to text, p_now timestamptz)
returns integer
language plpgsql
security definer
as $$
declare
  cnt integer := 0;
  note_row record;
  elem text;
  seen text[];
  result text[];
  key text;
  changed boolean;
begin
  for note_row in select id, tags from notes loop
    changed := false;
    seen := array[]::text[];
    result := array[]::text[];
    for elem in select jsonb_array_elements_text(note_row.tags) loop
      if lower(elem) = lower(p_from) then
        elem := p_to;
        changed := true;
      end if;
      key := lower(elem);
      if not (key = any(seen)) then
        seen := seen || key;
        result := array_append(result, elem);
      end if;
    end loop;
    if changed then
      update notes set tags = to_jsonb(result), updated_at = p_now where id = note_row.id;
      cnt := cnt + 1;
    end if;
  end loop;
  return cnt;
end;
$$;

-- p_updates: jsonb array of {id, status, sort}. Applies all in one transaction.
create or replace function reorder_tasks(p_updates jsonb, p_now timestamptz)
returns void
language plpgsql
security definer
as $$
begin
  update tasks t
  set status = u.status,
      sort = u.sort,
      updated_at = p_now,
      done_at = case
        when u.status = 'done' and t.status <> 'done' then p_now
        when u.status <> 'done' then null
        else t.done_at
      end
  from jsonb_to_recordset(p_updates) as u(id text, status text, sort integer)
  where t.id = u.id;
end;
$$;

-- p_updates: jsonb array of {id, stage, sort}. Applies all in one transaction.
create or replace function reorder_papers(p_updates jsonb, p_now timestamptz)
returns void
language plpgsql
security definer
as $$
begin
  update papers p
  set stage = u.stage,
      sort = u.sort,
      updated_at = p_now
  from jsonb_to_recordset(p_updates) as u(id text, stage text, sort integer)
  where p.id = u.id;
end;
$$;

revoke all on function convert_note_to_task from anon, authenticated;
revoke all on function merge_tag from anon, authenticated;
revoke all on function reorder_tasks from anon, authenticated;
revoke all on function reorder_papers from anon, authenticated;
