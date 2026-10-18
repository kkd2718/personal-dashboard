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
- `POST /api/trading/brief` (`TRADING_BRIEF_TOKEN`) — the trading VM pushes a **market-only** snapshot (macro/fx/rsi indicators,
  sectors, strategy states, upcoming/econ events, trade-check health; allow-list in `lib/logic/market-brief.ts`, forbidden-key filter,
  64KB cap) stored as `app_meta trading:market` (+ `trading:market:prev` rotated once per KST day). The PC collector's pull
  (`scripts/lib/trading-market.mjs` -> `/api/ingest` `tradingBrief`) is a fallback that writes only when the stored one is > 6h old.
  A trade check newly failing sends one Telegram alert. Digest 📈 매크로 block (`lib/telegram/macro.ts`) + `/macro`.
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
  `/today` + `/deadlines`, daily 07:00–08:00 KST digest (Vercel cron `0 22 * * *` UTC; Hobby fires anywhere in that hour) (`app_meta` table for once-per-day idempotency),
  immediate alerts on newly-critical status (`lib/logic/status-diff.ts`). `scripts/telegram-setup.mjs`
  discovers the chat id, generates the webhook secret, registers the webhook + commands.
- **3 (done)**: Google Apps Script per account (`integrations/google/Code.gs` → `POST /api/google/sync`,
  `GOOGLE_SYNC_TOKEN`): calendar events (ids carry the start instant — recurring instances share an
  Apps Script id), Gmail review/revision detection (`lib/logic/review-mail.ts`: MDPI and
  editing-service mail dropped, trashed mail = declined → candidate dismissed, one candidate per
  letter across both accounts, due-date lines past 3000 chars kept by `trimBody_`), and
  `WRITE_DEADLINES=true` mirrors open deadlines into Google Calendar as `[CC:key]` all-day events.
  Obsidian inbox note → memos via the collector.
- **Post-3 polish (2026-09-27)**: home v2 four lanes + account strip (`app_meta 'trading:summary'`,
  built by `scripts/lib/trading-summary.mjs` from the local trading dashboard's GET endpoints —
  totals/per-account values only, never holdings), sidebar 바로가기 (`lib/logic/quick-links.ts`),
  named progress bars (`라벨=path#section` backlogGlobs, `.json` = project-written `{key:{done,total}}`),
  published papers leave the home lane after 90 days, `next dev` never sends Telegram unless
  `TELEGRAM_DEV_SEND=1`. Project detail (`/projects/[slug]`) shows open backlog item titles per
  label (`scripts/lib/backlog.mjs`'s `listOpenItems`, automatic from the same labeled markdown bars)
  plus each project's own `docs/cc-status.json` (`{updatedAt, focus, next[], blockers[], done[]}`,
  written by that project's Claude session per the protocol block the SessionStart hook prints —
  `scripts/cc-inbox.mjs`), collected via `scripts/collector.mjs` and stored under meta key
  `project:detail:<id>` (`lib/logic/project-detail.ts`). A Stop hook (`cc-inbox.mjs stop`) nudges
  once per session — via `{"decision":"block",...}` — when the session committed but never
  refreshed the file (`scripts/lib/cc-hook.mjs`, marker file in `os.tmpdir()`).
- **CareNote** (`docs/PLAN_CARENOTE.md`): the calendar's day popover can view/add/edit/delete
  procedure records from the hosted CareNote app (separate repo `aesthetics-tracker`) via its
  token-authenticated JSON API (`lib/carenote/client.ts`, `CARENOTE_WS_TOKEN`). Nothing from
  CareNote is persisted dashboard-side — fetched live per visible calendar range and held in
  client state only; feature flag `careNoteEnabled = !!CARENOTE_WS_TOKEN`.
- **Daily routines (2026-09-30)**: `routine:items` (seeded 알렌/암기, from 2026-10-01) + `routine:done:<date>`
  in `app_meta` (`lib/logic/routines.ts`, `lib/routines-data.ts`, `app/actions/routines.ts`). Home 할 일
  lane shows a checkable 오늘 루틴 block (`components/home/routine-strip.tsx`, 🔥streak), settings has a
  루틴 editor. Telegram: `🔁 오늘 루틴` in the digest and `/today`, `/done <n|이름>`, and an evening
  reminder cron `/api/cron/evening` (12:00 UTC, `lib/telegram/evening.ts`, once/day via
  `telegram:evening:lastSent`). Adding `/done` needs `scripts/telegram-setup.mjs` rerun for the command menu.
  Count routines (`kind: 'count'`, 2026-10-13): per-day tally in `routine:count:<date>`, done when > 0 (kept
  in sync with `routine:done:<date>`); home ± stepper, `/done 알렌 5` (add) / `=12` (set), and
  `POST /api/routine/count` (`AGENT_TOKEN`) via `scripts/routine-count.mjs <id> +N` for other sessions.
- **AX (`docs/PLAN_AX.md`, in progress)**: slice 0 `lib/logic/ko-datetime.ts` (Korean date/time parser),
  slice 1 UserPromptSubmit hook (`cc-inbox.mjs prompt`, injects inbox items that arrived mid-session),
  slice 2 Telegram `/cal <text>` inserts straight into Google Calendar via OAuth refresh token
  (`lib/google/calendar.ts`, `scripts/google-oauth.mjs`, `GOOGLE_OAUTH_*` — unset => memo; optimistic row
  via `Repo.upsertCalendarEvent` when `GOOGLE_OAUTH_ACCOUNT` = the Apps Script `ACCOUNT`). `Repo.deleteMeta` added.
  Slice 3: free-text Telegram messages go through Jev (`lib/ai/jev.ts`, `AI_GATEWAY_API_KEY`; intent+target in one
  call, accepted only at top prob >= 0.6 and margin >= 0.2, 200 calls/day via `lib/ai/jev-budget.ts`) and become
  confirmable proposals with inline buttons (`lib/telegram/ax.ts`, `lib/logic/ax-*.ts`, pending in
  `app_meta telegram:pending:<id>`, update_id dedupe). Nothing changes until 적용; any doubt/failure/no key => plain memo.
  Slice 4: reply-waiting tracker (`lib/logic/waiting.ts`, `app_meta waiting:replies`): `waiting_reply` intent / `/waits` / `/wait`;
  each account's Apps Script `collectWaiting_` GETs `/api/google/waiting` (Gmail queries), posts matches in `payload.waiting` to
  `/api/google/sync`, which marks replies, classifies via Jev (budgeted) and sends one 📬 alert; digest lists stale waits.
  Waiting hardening: `OWNER_EMAILS` (comma list, never hardcoded) excludes own mail; `/wait <n|id> reopen`; list writes re-read and
  merge by id. Slice 5: Sunday weekly review from the evening cron (`lib/telegram/weekly.ts`, `lib/logic/weekly-review.ts`; `?weekly=1`
  forces): overdue/stale/project items with ✅/+1주/✖ buttons (pending `type:'weekly'`, 72h, per-item claim), project snooze via
  `ResolvedProjectItem.state:'snooze'` (`lib/project-checklist.ts` is the shared core of the home-lane action).
  Slice 6: first time a month's shifts (>= 20 days) reach `/api/google/sync` => one Telegram summary (`lib/logic/work-announce.ts`,
  `app_meta work:announced`, first run only seeds); `WORK_OFF_EVENTS=1` also creates timed `off` events. Slice 7: mail triage —
  Code.gs `triage` (5-min trigger, `setupTriage`) posts new inbox mail (<=300-char snippet, attachment names stripped, never
  attachments) to `POST /api/google/mail-triage` (`lib/logic/mail-triage.ts`): allow/deny in `app_meta mail:triage:config`
  (`/mailrule`), others via Jev noul >= 0.7 under the `mail` budget (300/day), dedupe by message id, 502 on Telegram failure.
  `task_create` intent: a free-text request to add a task (or a `할 일:`/`todo:` prefix, which skips intent classification) becomes a
  ➕ proposal; project from `@mention`, else a confident Jev project choice, else none; applied via `repo.createTask` on 적용.
  **ask (`docs/PLAN_ASK.md`)**: Telegram `/ask <question>` (`/ask+` Sonnet, `/ask!` Opus; reply to an answer = follow-up, 30 min) on the
  Claude API (`@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`). The webhook (`maxDuration` 60) returns 200 and runs `lib/ask/run.ts` in `after()`; manual
  tool loop (`lib/ask/loop.ts`) over read-only tools (`lib/ask/tools.ts`: no env/meta/trading accounts/`#비공개` memos); the only write path is
  `propose_change` (`lib/ask/propose.ts`, max 3) -> the AX pending/적용 flow (adds `send_memo`, `deadline_create` kinds). Routing: one Jev
  `complexity` question (`lib/logic/ask-route.ts`) -> Haiku default, Sonnet when confident `reason`. One spend ledger for every Claude call
  (`app_meta ask:spend:<cycleStart>` + day key, `lib/ask/spend.ts`), paced per billing cycle (`lib/logic/ask-budget.ts`: $100, day 23, 10%
  reserve, pace line + slack; prices in `lib/logic/ask-cost.ts`); `/budget` shows it. `lib/ask/title.ts`: Haiku title polish for AX `task_create`.
  New commands need `scripts/telegram-setup.mjs` rerun (`ask`, `budget`, `macro`). Smoke test: `scripts/ask-probe.mjs`.
  Mail alert extras (`lib/telegram/mail-actions.ts`, `lib/logic/mail-ai.ts`): with `ANTHROPIC_API_KEY`, mail-triage and review/revision-candidate
  alerts become one message per mail with a Haiku 1-2 line summary (feature `mail`, may use the reserve) and buttons 작업 준비 요청 (sent memo
  to the matched project, else a project-pick keyboard) / 답장 초안 (Haiku, Sonnet when under pace; shown as a code block, never written to
  Gmail). Pending record (`type:'mail'`, snippet <= 300 chars) is pruned after 48h (the 답장 초안 button then says so). Budget out/failure -> alert without a summary.

## Conventions
- Opus plans (`docs/PLAN.md`), Sonnet implements. Don't redesign a plan's data model/signatures
  silently — flag mismatches instead of quietly deviating.
- Dates are `'YYYY-MM-DD'` strings in Asia/Seoul; use `lib/logic/dates.ts` helpers, never raw
  `Date` arithmetic, to avoid UTC/KST off-by-one.
