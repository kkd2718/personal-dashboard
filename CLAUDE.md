@AGENTS.md

# Command Center — personal dashboard

Memo inbox + command center for projects/papers/reviews/deadlines. Full spec: `docs/PLAN.md`.

## Stack
Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, npm (no pnpm on Windows), Node 24.
dnd-kit (kanban), date-fns, zod, lucide-react, Vitest. Korean UI. Dark mode via `.dark` class
(`components/theme-toggle.tsx`), Tailwind `@custom-variant dark` in `app/globals.css`.

## Commands
- `npm run dev` — dev server on **:3100** (3000 is used by other local apps)
- `npm run build` / `npm start` (also :3100)
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — `vitest run`

## Data access — Repo adapter rule
All reads/writes go through `getRepo()` (`lib/repo/index.ts`), which returns a `Repo` interface
implementation. Never import `lib/repo/local.ts`, `lib/repo/supabase.ts`, or `node:fs` directly
from a client component — `Repo` must stay adapter-agnostic.
- `getRepo()` picks `SupabaseRepo` when `NEXT_PUBLIC_SUPABASE_URL` is set, else `LocalRepo`.
- `LocalRepo` (`lib/repo/local.ts`): JSON file `.data/db.json` (gitignored), serialized through an
  in-process mutex, atomic writes (temp file + rename), seeded via `lib/seed/index.ts` on first read
  (real data from `data/seed.local.json` if present, else the fictional `lib/seed.example.ts`).
- `SupabaseRepo` (`lib/repo/supabase.ts`, phase 1b): server-only, uses the service-role key (never
  the client). Row <-> domain mappers are pure functions in `lib/repo/mappers.ts` (unit-tested).
  Multi-row atomic ops (convert note→task, tag merge, kanban reorder) call Postgres functions via
  `.rpc()`, defined in `supabase/migrations/0001_init.sql`.
- Mutations happen via Server Actions in `app/actions/*.ts` (zod-validated input, `revalidatePath`
  after writes — see `app/actions/revalidate.ts`). Every action calls `requireUser()`
  (`lib/auth/require-user.ts`) first — a no-op in local mode, or throws unless the `cc_session`
  cookie is a valid, unexpired signed session.
- Pure logic (D-day math, kanban reorder, share parsing, project grouping) lives in `lib/logic/*.ts`
  with matching `*.test.ts`. Keep these framework-free so they stay easy to unit test.

## Auth (phase 1b)
Single-user **app password**, not Supabase Auth: Supabase's free-tier default SMTP forbids editing
the email template, so an OTP code (needed because iOS home-screen PWAs have a separate cookie jar
from Safari, ruling out magic links) can't actually be delivered — see the "Superseded" note in
`docs/PLAN_1b.md` §3. Login (`/login`, `components/login-form.tsx`, `app/actions/auth.ts`) checks
`APP_PASSWORD` in constant time (`lib/auth/password.ts`, HMAC'd with `SESSION_SECRET` first so the
compare is always fixed-length) and rate-limits failures (`lib/auth/rate-limit.ts`: 5/10min/IP + 1s
delay). On success it sets a 90-day rolling `cc_session` cookie: `issuedAt.expiresAt.hmacSignature`,
signed with Web Crypto (`lib/auth/session.ts`) so the same code runs in Proxy's Node **or** Edge
runtime. `proxy.ts` (Next 16 renamed `middleware.ts` to `proxy.ts` — see
`node_modules/next/dist/docs/.../proxy.md`) verifies that cookie on every route except `/login`,
`/api/capture`, `/api/ingest`, `/api/cron/*`, and static assets, redirecting to `/login?next=...`
when missing/invalid/expired, and reissuing the cookie when < 30 days remain. Auth is active
whenever `APP_PASSWORD` + `SESSION_SECRET` are both set, independent of which Repo adapter is used;
absent in local mode → `proxy.ts` and `requireUser()` are both no-ops, same as phase 1a/1c/1d. A
production deploy (`NODE_ENV=production`) with Supabase configured but auth env missing refuses to
serve (500) rather than running open. Supabase itself is used only as a database via the
service-role key — RLS is enabled on every table with **no policies** (service-role bypasses it;
anon/authenticated get nothing) — see `docs/reviews/plan-advice.md` §5 for why not `owner = auth.uid()`.

## Machine APIs (bearer tokens, constant-time compare via `lib/auth/bearer.ts`)
- `POST /api/capture` (`CAPTURE_TOKEN`) — iOS Shortcut / share sheet quick memo.
- `POST /api/ingest` (`INGEST_TOKEN`) — status collector (phase 2) writes `status_snapshot`/`project_activity`.
- `GET /api/collector/config` (`INGEST_TOKEN`) — phase 2a: tells `scripts/collector.mjs` which
  active/paused projects to probe (paths, backlogGlobs).
- `GET /api/agent-inbox`, `POST /api/agent-inbox/done` (`AGENT_TOKEN`) — phase 2a: SessionStart hook
  (`scripts/cc-inbox.mjs`) delivers a project's open agent tasks + sent memos into its Claude session.
- `GET /api/export` (session required) — full JSON dump of every table (Supabase free tier has no
  automated backups).
- `GET /api/cron/daily` (`CRON_SECRET`, called by Vercel — see `vercel.json`) — daily heartbeat.
- A missing server-side token always 503s (never "open"); a wrong one 401s.

## Environment variables
See `.env.example` for the full list with comments; `docs/SETUP.md` (Korean) walks through creating
the Supabase project and filling them in. Unset `NEXT_PUBLIC_SUPABASE_URL` → LocalRepo. Unset
`APP_PASSWORD`/`SESSION_SECRET` → no auth. The two are independent.
`scripts/migrate.mjs` applies `supabase/migrations/*.sql` via the Supabase **Management API**
(`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`), not a direct `postgres` connection — the
project's DB password isn't always available/known. Run scripts with
`node --env-file=.env.local --experimental-strip-types scripts/<name>.mjs` (or the matching
`npm run db:migrate` / `db:import` / `collector`).

## Phase status
- **1a (done)**: LocalRepo, seed data, all screens (홈/인박스/프로젝트/논문/마감/공유), PWA manifest,
  logic + tests, dark mode, mobile bottom nav + desktop sidebar.
- **1c (done)**: command-center restructure, queues (큐)/tasks, status probes, calendar.
- **1d (done)**: memos everywhere (quick capture with `@project #tag`, home memo panel, calendar
  day-add popover), `Task.assignee: 'me' | 'agent'` checklist split. **Agent tasks are what
  phase 2's SessionStart hook will deliver into that project's Claude session** — in 1d the user
  still ticks them manually from the checklist's 에이전트 tab.
- **1b (done)**: Supabase migration + SupabaseRepo, email-OTP auth, machine APIs (capture/ingest/
  export/cron), floating calendar popover, `lib/seed.example.ts` isolation. Deploys: the Vercel
  project is connected to GitHub, so every push to `main` auto-deploys to production
  (`npx vercel deploy --prod` with `VERCEL_TOKEN` still works for manual deploys).
- **2a (done)**: PC collector (`scripts/collector.mjs`, hourly Task Scheduler) posts git/session/
  backlog status to `/api/ingest`; `Project.backlogGlobs` + a second progress bar for markdown-backlog
  projects (e.g. Amgi); SessionStart hook (`scripts/cc-inbox.mjs` + `/api/agent-inbox`) delivers a
  project's open agent tasks and "sent" memos into its Claude session.
- **2b (done)**: Telegram bot — memo capture (`@프로젝트 #태그`) shared with `/api/capture`,
  `/today` + `/deadlines`, daily 09:00 digest (`app_meta` table for once-per-day idempotency),
  immediate alerts on newly-critical status (`lib/logic/status-diff.ts`). `scripts/telegram-setup.mjs`
  discovers the chat id, generates the webhook secret, registers the webhook + commands.
- **2**: Gmail/Obsidian dispatch into the inbox is still phase 3 (see below).
- **3**: Google Calendar, Gmail review-deadline extraction, Obsidian sync.

## Conventions
- Opus plans (`docs/PLAN.md`), Sonnet implements. Don't redesign a plan's data model/signatures
  silently — flag mismatches instead of quietly deviating.
- Dates are `'YYYY-MM-DD'` strings in Asia/Seoul; use `lib/logic/dates.ts` helpers, never raw
  `Date` arithmetic, to avoid UTC/KST off-by-one.
