# Phase 2a — PC collector, backlog progress, agent inbox (2026-09-26)

Baseline: 0389344 (+ deployed at https://kkd-dashboard.vercel.app). Spec overrides earlier docs where different.
Constraint: scripts that run in WSL must work on **Node 18** (no `--env-file`, no TS stripping): plain ESM `.mjs`, parse `.env.local` manually, use global `fetch`.

## 1. Collector (`scripts/collector.mjs`, plain JS, Node ≥18)
Runs on the Windows PC hourly (Task Scheduler) and on demand. No dev server needed.
1. Load env from `.env.local` next to the repo (manual parser: `KEY=VALUE`, ignore comments/blank, strip CR/quotes). Needs `CLOUD_URL`, `INGEST_TOKEN`, optional `TRADING_URL`.
2. `GET ${CLOUD_URL}/api/collector/config` (bearer INGEST_TOKEN) → `{ projects: [{id, name, status, paths, backlogGlobs}] }` (active + paused only). New route, server-side from repo.
3. For each project path:
   - Windows path (`C:\…`): `git -C <p> log -1 --format=%cI%x09%s`, `git -C <p> rev-parse --abbrev-ref HEAD`, `git -C <p> status --porcelain` via `execFile` (timeout 5s).
   - WSL path (`/home/…` or `~/…`): same commands through `wsl.exe -e git -C <p> …` (timeout 8s). If `wsl.exe` missing/fails → skip silently with reason.
   - **lastSessionAt**: newest mtime of `*.jsonl` in the Claude transcript dir for that path. Windows dir = `%USERPROFILE%\.claude\projects\<encoded>` where encoded = path with every char not `[A-Za-z0-9]` replaced by `-` (e.g. `C:\Users\기덕\Desktop\Work\trading-system` → `C--Users----Desktop-Work-trading-system`; verify against existing dirs). WSL: `wsl.exe -e bash -lc 'stat -c %Y ~/.claude/projects/<enc>/*.jsonl | sort -n | tail -1'`, where WSL-side encodings exist for both `/home/...` and `/mnt/c/...` forms — check both (a Windows project may also have WSL sessions under `-mnt-c-Users----Desktop-Work-...`). Take the max.
   - **Backlog**: for each glob in `backlogGlobs` (relative to project path; simple patterns `docs/*.md` / exact file), read file (WSL via `wsl.exe -e cat`), count with `countBacklog(text)` (below).
4. Trading probe: same logic as `lib/status/trading.ts` (GET-only `/api/alerts`, `/api/health`, `/api/overview`), re-implemented in plain JS in `scripts/lib/trading-probe.mjs`; **never POST**.
5. Build `statusItems` (same rules as lib/status: trading alerts/daemon/summary, git stale/quiet, one dirty summary line) and `projectActivity[]` (branch, lastCommitAt, lastCommitMsg, dirty, lastSessionAt, metrics {backlogOpen, backlogDone}).
6. `POST ${CLOUD_URL}/api/ingest`. Also write the payload to `.data/collector-last.json` for debugging. Exit 0 even if some probes fail; non-zero only if ingest fails.
- Shared pure functions in `scripts/lib/*.mjs` (plain JS + JSDoc) so they're unit-testable from vitest: `encodeProjectDir(path)`, `countBacklog(text)`, `toWslPath/isWslPath`, `buildStatusItems(...)`.
- Delete `scripts/push-status.mjs` (superseded) or make it call collector.

`countBacklog(text) → {open, done}`:
- Checkbox lines `^\s*[-*] \[( |x|X)\]` → open/done.
- Else top-level numbered items `^\d+\.\s` (Amgi BACKLOG style): done if the item's first line contains `✅` or `~~` strike at start, or `**완료` ; otherwise open. Nested/indented lines ignored.
- If a file has checkboxes, numbered items are ignored (avoid double counting).
Tests: fixtures for checkbox md, Amgi-style numbered md (use 3–4 lines shaped like `docs/BACKLOG.md` of Amgi: `13. ~~title~~ **완료·배포(...)**` → done; `3. **테스트 격리 부채 라운드** — ... ✅ **해소**` → done; `8. **something**` → open), mixed.

## 2. Data model / server
- `Project.backlogGlobs: string[]` (default []). Seed data (data/seed.local.json + Supabase via a tiny migration script or SQL update): amgi → ['docs/BACKLOG.md']; realty-chart → ['docs/ROADMAP.md','docs/TODO.md'] only if those exist (collector ignores missing); trading-system → []; flow-sorter → ['docs/*.md'] no — leave [] (user can edit). Editable in project edit form (comma-separated).
- Migration `0002_phase2a.sql`: `alter table projects add column if not exists backlog_globs jsonb not null default '[]'`; notes: `delivered_at` exists? (verify) ; tasks: add `delivered_at timestamptz` for agent tasks.
- Progress logic: `projectProgress` uses tasks; **if ProjectActivity.metrics has backlogOpen/backlogDone and the project has 0 tasks OR is group 'app'**, show a second bar "BACKLOG n/m" under the task bar (don't merge the numbers). Home progress list shows whichever exists (tasks first).
- Project card / progress list show `마지막 세션 n시간 전` from lastSessionAt and `커밋 n일 전`.
- Status panel (cloud): unchanged, but the snapshot age badge now meaningful.

## 3. Agent inbox (SessionStart hook)
Goal: when a Claude Code session starts in a project dir, it receives that project's open **agent** tasks and memos the user "sent" to that project.
- API `GET /api/agent-inbox?path=<cwd>` (bearer `AGENT_TOKEN`, new env; add to Vercel): normalize path (lowercase drive, `\`→`/`, `/mnt/c/` ↔ `c:/`, strip trailing `/`), match project whose any `paths` entry is a prefix of cwd (longest match). Returns `{ project: {id,name}|null, tasks: [{id,title,description,dueDate,milestone}], memos: [{id,body,tags}] }` where tasks = assignee 'agent' & status≠done; memos = notes with projectId = project & status 'sent'. Marks returned items `deliveredAt=now` (first delivery only).
- API `POST /api/agent-inbox/done` (bearer AGENT_TOKEN) body `{taskId}` or `{noteId}` → task status 'done' (doneAt) / note status 'done'.
- Memo UI: "프로젝트로 보내기" action on memos with a project → status 'sent' (badge "에이전트에게 보냄", shows delivered time once delivered). Task board: agent tasks show "전달됨 hh:mm" when deliveredAt set.
- Hook script `scripts/cc-inbox.mjs` (plain JS, Node ≥18):
  - `node cc-inbox.mjs hook` — reads SessionStart JSON from stdin (`cwd` field; fallback process.cwd()), loads env from the dashboard repo's `.env.local` (path resolved relative to the script file; works from `/mnt/c/...` in WSL), calls agent-inbox with 3s timeout. On success with ≥1 item prints a concise Korean markdown block to stdout:
    ```
    ## Command Center — 이 프로젝트에 전달된 항목
    에이전트 할 일:
    - [t-123] 배포 (Cloud Run + Vercel) (마감 10-02)
    사용자 메모:
    - [n-45] ... #태그
    완료하면: node "<abs script path>" done t-123
    ```
    On no items / error / timeout: print nothing, exit 0 (never block or slow a session >3s).
  - `node cc-inbox.mjs done <id>` — POST done; prints result.
  - `node cc-inbox.mjs list [path]` — same as hook but for manual use.
- Hook registration is done by the planner (me) after review, not by the implementer: Windows `~/.claude/settings.json` and WSL `~/.claude/settings.json` → `hooks.SessionStart` command entries with timeout 5. Implementer only documents the exact JSON in docs/SETUP.md.

## 4. Scheduling (documented + script, planner registers)
- `scripts/register-collector-task.ps1`: creates Windows Scheduled Task "CommandCenterCollector": every 60 min + at logon, run only when user is logged on, action `node "<repo>\scripts\collector.mjs"` with working dir = repo; `-ExecutionTimeLimit 00:05`. Idempotent (replace if exists). Planner runs it after review.

## 5. Tests / acceptance
- vitest: countBacklog fixtures, encodeProjectDir (verify against the real dir names listed in ~/.claude/projects: e.g. `C:\Users\기덕\Desktop\Work\trading-system` ↔ `C--Users----Desktop-Work-trading-system`), path normalization/prefix matching for agent-inbox (Windows, /mnt/c, /home), agent-inbox route handler (pure part), collector config route auth.
- Live: run `node scripts/collector.mjs` against the **deployed** cloud (CLOUD_URL) — ingest must succeed; then check Supabase `project_activity` rows have lastSessionAt for trading-system/personal-dashboard and backlog metrics for amgi. Run `echo '{"cwd":"C:\\\\Users\\\\기덕\\\\Desktop\\\\Work\\\\traicer-corp\\\\flow-sorter"}' | node scripts/cc-inbox.mjs hook` against a local dev server or the cloud after deploy → prints flow-sorter agent tasks (배포, 당일 버그 기록 양식 준비).
- Deploy: implementer may run `npx vercel deploy --prod` with VERCEL_TOKEN from .env.local (never print) after tests pass, and add `AGENT_TOKEN` (generate, append to .env.local) to Vercel production env. Run migration 0002 via `npm run db:migrate` first.
- typecheck/lint/tests/build pass.

## 6. Rubric
1. Hook never blocks/slows sessions: hard 3s timeout, silent on error, no stdout noise when empty.
2. Tokens never printed; AGENT_TOKEN separate from INGEST/CAPTURE.
3. Collector GET-only to trading; git read-only; WSL failures isolated.
4. Path normalization correct across Windows / /mnt/c / /home; longest-prefix match.
5. countBacklog matches Amgi's real BACKLOG format without double counting.
6. deliveredAt set only on first delivery; done endpoint idempotent.
7. Node 18 compatibility of every script that WSL runs (no optional chaining issues are fine in 18; no --env-file; no import attributes).
