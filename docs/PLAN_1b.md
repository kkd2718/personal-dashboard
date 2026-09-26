# Phase 1b — isolation, Supabase, deploy, iPhone capture (2026-09-26)

Baseline: 5dd14c5. Conventions: CLAUDE.md, docs/PLAN.md (decisions), docs/reviews/plan-advice.md (1b advice). This file is the spec.

## 0. Carry-over UI fix
Calendar day popover → **floating overlay** anchored to the clicked cell (portal to body, `position: fixed`, computed from cell rect; flips above/left when it would overflow the viewport; width 340px; max-height 70vh with internal scroll). Closes on Esc, outside click, and route change; focus moves into it and returns to the cell. On < md screens render as a **bottom sheet** (full width, rounded top, safe-area padding). Calendar grid must not reflow when it opens.

## 1. Isolation (user wants it even though repo stays private)
- `lib/seed.example.ts`: fictional sample (3 projects, 2 papers, a few tasks/memos), committed.
- Real data → `data/seed.local.json` (gitignored; add `/data/*.local.json` to .gitignore). Generate it once from current `lib/seed.ts` via `scripts/export-seed.mjs` (or a tsx one-off), then **delete lib/seed.ts**.
- Loader `lib/seed/index.ts`: server-only; reads `data/seed.local.json` if present, else example.
- No personal constants in code: `ALLOWED_EMAIL`, `TRADING_URL`, `LOCAL_PROBES` etc. from env. Add `.env.example` documenting every variable (no values).
- grep gate script `scripts/check-isolation.mjs` (run in `npm test` via a vitest test): fails if tracked files outside `data/` and `docs/` contain `기덕`, `skdgh23`, `kkd2718`, `C:\\Users`, `/home/kkd2718`. (docs are exempt.)

## 2. Supabase
Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key ok), `SUPABASE_SERVICE_ROLE_KEY` (secret key ok), `SUPABASE_DB_URL` (for migrations only), `ALLOWED_EMAIL`.
- Migration `supabase/migrations/0001_init.sql`: tables projects, milestones, tasks, notes, papers, review_jobs, deadlines, project_activity, status_snapshot (id text pk 'latest', items jsonb, collected_at), heartbeat (id int pk, at timestamptz). Columns snake_case; arrays/objects as jsonb (links, paths, aliases, tags, submissions, remind_days, metrics). `updated_at` default now(). **RLS enabled on every table with no policies**; revoke all from anon, authenticated.
- `scripts/migrate.mjs`: applies migrations in order using `postgres` (porsager) with SUPABASE_DB_URL; idempotent (`create table if not exists`), records applied files in `_migrations` table.
- `lib/repo/supabase.ts` implementing the existing `Repo` interface with `@supabase/supabase-js` **service-role client, server-only**. Pure mappers `toRow/fromRow` per entity in `lib/repo/mappers.ts` (unit-tested round trip incl. defaults for missing fields). Multi-row atomic ops (convertNoteToTask, tag rename/merge, reorders): use a Postgres function via `rpc` where atomicity matters (convert_note_to_task, rename_tag, merge_tag, reorder_tasks, reorder_papers) defined in the migration; otherwise sequential upserts.
- `getRepo()`: Supabase when `NEXT_PUBLIC_SUPABASE_URL` set, else LocalRepo.
- `scripts/import-to-supabase.mjs`: reads `.data/db.json` if present else `data/seed.local.json`; upserts all entities (idempotent by id). Dry-run flag prints counts.

## 3. Auth (single user, iPhone PWA-safe)
> **Superseded 2026-09-26**: Supabase free tier + default SMTP cannot edit email templates, so OTP codes are impossible. Auth = app password (`APP_PASSWORD`) + HMAC-signed 90-day rolling cookie (`SESSION_SECRET`), rate-limited; verified in proxy/middleware and `requireUser()`. Supabase is used only as a database via the service-role key. The text below is kept for history.
- Supabase Auth **email OTP code** (6 digits), not magic link: iOS home-screen apps have a separate cookie jar, so links opened in Safari wouldn't log in the PWA. `/login`: email → "코드 보내기" → code input → verify.
- `@supabase/ssr` cookie session; `middleware.ts` (or `proxy.ts` per Next 16 convention — check which the installed Next expects) protects everything except `/login`, `/api/capture`, `/api/ingest`, `/api/cron/*`, static assets. Reject any session whose email ≠ `ALLOWED_EMAIL` (sign out + 403 page).
- Server actions verify the session before using the service-role repo (helper `requireUser()`).
- When Supabase env is absent (local mode), auth is skipped entirely.
- `/share` keeps its query params through the login redirect (`next` param).

## 4. Machine APIs (bearer tokens, constant-time compare)
- `POST /api/capture` (`CAPTURE_TOKEN`): body `{ text: string, date?: string }` → parseCapture → note (source 'share' — add 'shortcut' to Note.source union). Returns `{ ok, id, projectId, tags }`. For iOS Shortcut.
- `POST /api/ingest` (`INGEST_TOKEN`): body `{ statusItems: StatusItem[], projectActivity?: ProjectActivity[] }` → upsert status_snapshot 'latest' + project_activity. Validate with zod; cap payload 256KB.
- `GET /api/export` (session required): full JSON dump of all tables (download).
- `GET /api/cron/daily` (`Authorization: Bearer ${CRON_SECRET}` as Vercel sends): upsert heartbeat; later phases add reminders. `vercel.json`: `{"crons":[{"path":"/api/cron/daily","schedule":"0 0 * * *"}]}` (09:00 KST).
- Status panel: in cloud (LOCAL_PROBES off) show `status_snapshot.latest` items + "PC 기준 hh:mm" age badge; stale (> 3h) badge amber. Locally keep live probes.
- `scripts/push-status.mjs`: runs the local probes via the local dev/prod server `GET http://localhost:3100/api/status` **or** directly imports probe modules (prefer calling the local API to reuse code) and POSTs to `${CLOUD_URL}/api/ingest`. (Scheduling is phase 2; document manual run.)

## 5. Docs for the user (Korean, short)
`docs/SETUP.md`: Supabase project creation (region Seoul), where to find keys, fill `.env.local`, `npm run db:migrate`, `npm run db:import`, Vercel import from GitHub + env vars list, iOS Shortcut recipe for `/api/capture` (Share Sheet input → Get Contents of URL POST JSON with Authorization header), adding to Home Screen.

## 6. Tests / acceptance
- Unit: mappers round-trip; bearer compare; capture API handler (pure part) → note fields; isolation gate; ingest zod schema rejects oversized/invalid.
- Without Supabase env: app behaves exactly as before (LocalRepo, no auth) — verify with the dev server + screenshots (/, calendar popover open via CDP script at scratchpad/popover-shot.mjs — you may adapt it).
- With env (only if `.env.local` contains Supabase vars when you run): run migrate + import dry-run; otherwise skip and say so.
- typecheck, lint, tests, build pass.

## 7. Rubric
1. Service-role key never reaches the client bundle (grep `.next/static` after build for `SERVICE_ROLE`/key prefix).
2. Every server action and non-public route checks session + ALLOWED_EMAIL.
3. RLS on for all tables; anon has no grants.
4. Mappers tolerate missing/null jsonb.
5. Tokens compared in constant time; tokens absent → endpoint returns 503, never open.
6. Popover overlay positioning/flip, Esc/outside close, bottom sheet on mobile, no grid reflow.
7. Isolation gate passes; lib/seed.ts removed; app runs from data/seed.local.json.
