# PLAN.md review — advisor (Fable), 2026-09-25

Scope: things that change 1b–3 architecture or are cheap to fix while 1a is in flight. Ranked by impact.
Tags: **NOW** = change in 1a types/seed today · **1b/2/3** = change in that phase · **IGNORE** = drop or leave as is.

## 1. Idea → Claude session delivery: use a user-level SessionStart hook, not inbox.md or MCP — **2 (design), NOW (types)**
- Claude Code adds a `SessionStart` command hook's stdout (or `hookSpecificOutput.additionalContext`) to the model context, and hooks in
  `~/.claude/settings.json` apply to every project. The hook gets `cwd`. So: `SessionStart` → `curl $CC_URL/api/inbox?path=<cwd>` (bearer)
  → notes for that project appear in context at session start, zero per-project setup, no file to keep in sync, no MCP server. [1]
- Consequences now: (a) mapping is by **path**, so `Project.localPath: string | null; wsl: boolean` should become `paths: string[]`
  (Windows path and/or `/home/...` WSL path; one project often has both). (b) `Note` needs `deliveredAt: string | null` so the hook can
  fetch "undelivered" and mark them; keep `status: 'sent'` as the user-facing state. (c) Keep `cc inbox <slug>` CLI as a 20-line fallback.
- `inbox.md` written by an hourly collector is stale by design and adds a file to every repo; MCP is heavier than a hook and the MCP
  servers aren't even available at SessionStart. **IGNORE** both.

## 2. Collector: event-driven from Claude Code hooks first, Task Scheduler second — **2**
- Same user-level hooks file: a `Stop` or `SessionEnd` hook (input has `cwd`, `transcript_path`) can POST git branch/last commit/dirty +
  MEMORY.md digest to `/api/ingest` at the end of every Claude session. That is "write only on change" for free and covers WSL sessions
  natively (the hook runs inside the WSL Claude). [1]
- If you still want the hourly Windows sweep: the task must be **"Run only when user is logged on"** — session-0 tasks cannot reach WSL at
  all (Store WSL regression) and `\\wsl$` needs the distro running. Shell out with `wsl.exe -d <distro> -- git -C <path> ...` rather than
  reading `\\wsl$` (starts the distro, avoids 9P slowness). [2]
- **NOW**: put collected data in its own entity, not on `Project`, so machine writes never clobber user edits and 1b SQL has the table:
  `ProjectStatus { projectId, branch, lastCommitAt, lastCommitMsg, dirty, lastSessionAt, memoryDigest, metrics: Record<string, number|string>, collectedAt, source: 'hook'|'collector' }`.
  Derive "방치된 프로젝트" (no commit/session ≥ 14 days, status active) from it — the most useful single view for someone running ~20 projects.

## 3. Supabase free tier: 2-active-project cap and backup gap matter more than the pause — **1b**
- Pause: "1 week of inactivity", where activity = API/database requests from clients; pg_cron does not count. A daily heartbeat via
  supabase-js from a Vercel cron route is sufficient; no need for hourly writes. [3][4]
- Free plan is limited to **2 active projects per org**. flow-sorter (if un-paused) + this app = 2; a third free project can't be active.
  Check which org this lands in before 1b. [4]
- Free plan has no automated daily backups (Pro feature). flow-sorter already lost 2 months to a pause; add `GET /api/export` (auth'd JSON
  dump of all tables, same shape as `.data/db.json`) in 1b and have the collector save it weekly. Also makes LocalRepo ↔ Supabase migration trivial.

## 4. Vercel Hobby cron: once per day, ±59 min; use one `/api/cron/daily` — **1b (name it now)**
- Hobby: 100 cron jobs/project but each may run at most once per day; more frequent expressions fail deployment; precision is per-hour. [5]
- So D-7/3/1 Telegram reminders, heartbeat, and later Gmail/Calendar refresh all live in one daily job. Name the route `daily` not `heartbeat`
  now so 1b/3 don't rename. Schedule e.g. `0 22 * * *` UTC (= 07:00–07:59 KST). Hourly needs come from the PC hooks, not Vercel.

## 5. Auth/RLS for one user: server-only service role + RLS "deny all" + email gate; drop `owner` column — **1b**
- `owner = auth.uid()` policies force every server read to run through a user-JWT-bound `@supabase/ssr` client and an `owner` column on
  each table — plumbing that buys nothing for one user. Simpler and safer: enable RLS on every table with **no policies** (anon and
  authenticated both denied), use the service-role key only in server code, and gate everything in `proxy.ts`/middleware on Supabase
  session email === `ALLOWED_EMAIL`. Realtime/client queries are not needed here.
- Magic link is fine: built-in SMTP is 2 emails/hour and team-member addresses only, which is exactly this user; sessions persist per
  device so it's one email per device, not per visit. Custom SMTP only if it bites. [6] **IGNORE** Google OAuth as login.
- Machine callers (hooks, collector, iOS Shortcut, Telegram webhook) need a bearer-token path, so design `/api/*` around
  `Authorization: Bearer <CC_TOKEN>` from 1b, separate from the cookie session.

## 6. Web Share Target is Android-only; plan the iPhone path explicitly — **NOW (small), 2**
- Safari/iOS does not implement `share_target` (WebKit bug open since 2019); on Android Chrome it works, and a service worker is no
  longer required for installability (Chrome ≥108 mobile). [7][8]
- If the phone is an iPhone, the capture path is an iOS Shortcut in the share sheet → "Get Contents of URL" POST to `/api/capture` with
  the bearer token (10-minute setup, works offline-queued via Shortcuts). This is the same endpoint the Telegram bot needs. [9]
- NOW: (a) login redirect must preserve `?title&text&url` on `/share` or Android shares are lost on first use after cookie expiry;
  (b) `MetadataRoute.Manifest` may not type `share_target` — cast rather than drop it.
- Move Telegram bot from phase 3 to phase 2: it is the only capture channel that works on both OSes and from a PC.

## 7. Google: no OAuth in the app; one Apps Script pushes Gmail + Calendar — **3**
- A Google Cloud OAuth client left in "Testing" expires refresh tokens after 7 days; "In production" with Calendar (sensitive scope)
  means verification or a permanent "unverified app" warning. [10] Apps Script runs as the user with Gmail and Calendar access, no OAuth
  client, free time-driven triggers. Extend the planned Gmail script to also push the next 30 days of events to `/api/ingest`; write-back
  (app → Calendar) via the same script polling an `outbox` table. Read-only display alternative with zero code: the calendar's private ICS URL.

## 8. Data model gaps that are cheap today — **NOW**
- `Paper`: add `submissions: { journal, submittedAt, decision: 'pending'|'rejected'|'major'|'minor'|'accepted', decidedAt }[]`.
  Rejection → next target journal is the normal loop; `journal` + `targetJournals` alone lose the history and the "days under review" number.
- `Deadline`: `kind` values are fine; add `recurrence: null | 'monthly' | 'yearly'` only if the 연구과제 reports repeat. Otherwise IGNORE.
- Today in KST must be computed per request on the server (Vercel runs UTC, pages get cached): `export const dynamic = 'force-dynamic'`
  or `connection()` on pages that render D-day. Rubric item 1 covers the math; this covers caching.

## 9. Cut / defer — **IGNORE**
- Obsidian **two-way** sync: one-way (vault `Inbox/CC` → notes, via the same PC hook/collector) is 90% of the value with 10% of the conflict handling.
- Month calendar view in 1a: the grouped list + Google Calendar (phase 3) make it redundant; keep if already built, don't polish.
- "Per-project summary widgets" (phase 3): `ProjectStatus.metrics` + one generic key/value card covers trading total and CareNote next date.
- MCP server, hourly Vercel work, `owner` column, Vercel Deployment Protection as app auth (free on Hobby for production, but it would
  block share target, Telegram webhook and hook POSTs unless every caller sends the bypass header). [11]

## Sources
[1] https://code.claude.com/docs/en/hooks · [2] https://github.com/microsoft/WSL/issues/9271 , https://github.com/Microsoft/WSL/issues/2912
[3] https://supabase.com/docs/guides/platform/free-project-pausing · [4] https://supabase.com/pricing
[5] https://vercel.com/docs/cron-jobs/usage-and-pricing · [6] https://supabase.com/docs/guides/auth/auth-smtp
[7] https://bugs.webkit.org/show_bug.cgi?id=194593 , https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target
[8] https://developer.chrome.com/blog/update-install-criteria · [9] https://support.apple.com/guide/shortcuts/share-actions-apdaf74d75a5/ios
[10] https://developers.google.com/identity/protocols/oauth2#expiration · [11] https://vercel.com/docs/deployment-protection/usage-and-pricing
