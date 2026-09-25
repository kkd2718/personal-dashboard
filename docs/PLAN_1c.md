# Phase 1c — Command-center restructure (after first GUI feedback, 2026-09-25)

Baseline: commit c47250e (phase 1a). Still LocalRepo only. Read docs/PLAN.md for stack/conventions; this file overrides it where they differ.

## User feedback → decisions
- Main page = **3-column command center** (desktop): left checklist (today/this week), center calendar (queue ranges + deadlines), right status checks + project progress %. Mobile: stacked.
- Kanban does NOT go on home; it lives in project detail (Trello-style task board) and papers page.
- "인박스" is unclear → rename to **메모**; add "할 일로 전환" (memo → Task in a project/queue).
- Need **queues (큐) with timeline** and **progress %** per project and per queue.
- Status checks (e.g. trading account) must exist now, not phase 2.
- Layout wastes width (content capped ~700px on 1440px); papers kanban shows 3 of 7 columns → use full width.
- 학위논문 is finished → status 'done'. KnowledgeInjection_LLM published (already).

## 1. Data model changes (`lib/types.ts`)
```ts
type MilestoneStatus = 'planned' | 'active' | 'done';
interface Milestone {            // UI name: 큐
  id: string; projectId: string; title: string;
  startDate: string | null; endDate: string | null;   // YYYY-MM-DD, inclusive
  status: MilestoneStatus; sort: number; updatedAt: string;
}
type TaskStatus = 'todo' | 'doing' | 'done';
interface Task {
  id: string; projectId: string | null; milestoneId: string | null;
  title: string; description: string | null;
  status: TaskStatus; dueDate: string | null; doneAt: string | null;
  sort: number;                  // dense per (projectId, status)
  createdAt: string; updatedAt: string;
}
// Note: add `taskId: string | null` (set when converted).
```
Deadline stays for non-task dated events (interview, date, grant, personal). ReviewJob unchanged.
Repo: CRUD for milestones and tasks; `convertNoteToTask(noteId, {projectId, milestoneId, title, dueDate})` creates the Task and sets note.status='done', note.taskId. LocalRepo: add arrays; on load, **missing arrays default to []** and missing new fields default (null) — a tolerant loader so old `.data/db.json` never crashes (fixes the migration issue flagged in 1a).

## 2. Pure logic (`lib/logic/*`, tested)
- `progress(tasks): { done: number; total: number; pct: number | null }` — pct = round(100*done/total), null when total 0.
- `milestoneProgress(milestone, tasks)`, `projectProgress(projectId, tasks)` — thin wrappers.
- `checklist(tasks, deadlines, reviews, today): { overdue, today, thisWeek, doing }` — thisWeek = due within today+1..end of ISO week (Sunday) in KST; `doing` = status 'doing' with no due date; done tasks excluded except tasks completed today (shown struck-through at the bottom of `today`). Deadlines (not done) and reviews (invited|accepted with dueDate) are merged as read-only items with kind labels.
- `calendarEvents(monthStart, {milestones, tasks, deadlines, reviews}): { ranges: RangeSeg[]; points: Record<date, Point[]> }` — ranges = milestones with both dates, **split into per-week-row segments** `{milestoneId, weekIndex, colStart(1..7), colEnd, isStart, isEnd, lane}`; lanes assigned greedily so overlapping segments in the same week don't collide; milestones with only startDate render as a point on that date. Points = task dueDates (not done), deadlines, review dueDates. Weeks start Monday.
- `staleness(lastCommitAt, today): 'fresh'|'quiet'|'stale'` — ≤7d fresh, ≤21d quiet, else stale.

Tests (concrete):
- progress([]) → pct null; 1 of 3 done → 33.
- checklist: task due yesterday → overdue; due today → today; due Sunday of this week → thisWeek; due next Monday → excluded; doing w/o date → doing; review accepted due in 3 days → thisWeek (if within week) else excluded.
- calendarEvents: milestone 2026-09-24..2026-10-07 in Sept 2026 view (weeks start Mon 2026-08-31) → segments: week of 09-21 cols 4..7 (isStart), week 09-28 cols 1..7, week 10-05 cols 1..3 (isEnd, only if that week is in the grid). Two overlapping milestones → lanes 0 and 1.
- staleness boundaries 7/8/21/22 days.

## 3. Status checks (local probes) — `lib/status/*` (server-only)
Runs only when `LOCAL_PROBES !== '0'` and server is on the user's PC (default on in dev/local). Each probe: timeout 3s, result cached in-memory 5 min, never throws (returns `{ok:false, reason}`).
- **trading** (`http://127.0.0.1:8899`): GET `/api/alerts` → list `{severity: 'critical'|'warn'|'info', message}`; GET `/api/health` → daemons `{label, last_run, next_due}` (flag when `next_due < today` or last_run older than next_due by >3 days); GET `/api/overview` → `grand_total.total_krw` and `real_total_krw` only (summary numbers; no account numbers). Unreachable → one info item "계좌 대시보드 꺼짐 (PC)".
- **git**: for projects whose `paths` contain a Windows path that exists, `git -C <path> log -1 --format=%cI%x09%s` and `git status --porcelain` (execFile, timeout 3s) → upsert ProjectActivity. WSL paths (`/home/...`): skip in 1c (show "WSL — 수집기 대기").
- Output `StatusItem { id, severity: 'critical'|'warn'|'info'|'ok', source: 'trading'|'git', projectId|null, title, detail, href|null }`, sorted critical→warn→info→ok.
- Probes are invoked from the home page server component (await Promise.all, total budget ~3.5s) and from `/api/status` (GET, JSON) for a client refresh button.

## 4. Screens
Global: remove the narrow max-width container. App shell: sidebar (desktop) + main `w-full px-4 lg:px-6 max-w-[1680px]`. Nav: 홈 · 메모 · 프로젝트 · 논문 · 캘린더 (rename 마감 → 캘린더; route `/calendar`, keep `/deadlines` redirecting).

**홈 `/`** — quick capture full width on top. Below `grid gap-4 lg:grid-cols-[minmax(280px,340px)_1fr_minmax(300px,360px)]`:
- Left **체크리스트**: sections 지남/오늘/이번 주/진행 중; checkbox toggles task done (optimistic); items show project color dot, D-day chip; "+ 할 일" inline add (title, project, due).
- Center **캘린더**: month grid (Mon-first) with milestone range bars (lane rows, project color, title on isStart segment) and point chips (task/deadline/review/date icons by kind, max 3 + "+n"); prev/next/today; toggle 월/주. Click day → popover list. Height fits viewport on desktop.
- Right **상황 체크** (StatusItems, critical red / warn amber, refresh button, "마지막 확인 hh:mm") then **진행률**: active projects with ≥1 task: name, current active queue title, bar + `done/total (pct%)`; click → project detail.
- Mobile order: capture → 상황 체크 (only critical/warn) → 체크리스트 → 캘린더 (week view default) → 진행률.

**메모 `/memo`** (was /inbox; redirect old path) — intro line "떠오른 생각을 적어두고, 필요하면 할 일로 바꾸세요". Each memo: "할 일로 전환" opens a small dialog (project, queue, title prefilled from first line, due date) → creates task. Filters as before.

**프로젝트 `/projects`** — responsive card grid (1/2/3/4 cols), each card with progress bar, active queue, staleness badge, links.
**프로젝트 상세 `/projects/[slug]`** — header (name, status, links, edit). Queue strip: milestones as horizontal chips with dates + progress bar; add/edit queue (title, start, end, status). **Task board**: 3 columns 할 일 / 진행 중 / 완료 (dnd-kit, full width), queue filter chips; card = title, due chip, queue label; click to edit (title, description, due, queue). Below: memos, deadlines, papers (with submissions).

**논문 `/papers`** — full-width board, columns `flex-1 min-w-[180px]`; empty columns collapse to a 44px vertical strip showing the stage name + count (expand on hover/drag-over); board `h-[calc(100dvh-...)]`, columns scroll internally; compact cards (title, track chip, journal, next action, submission count). Papers can be clicked → side panel editor incl. submissions. Review tab unchanged but full width table on desktop.

**캘린더 `/calendar`** — same calendar component large + agenda list (upcoming 30 days) on the right; add deadline/event.

## 5. Seed changes (only facts; no invented dates except known ones)
- 학위논문 project status 'done' (unpin).
- flow-sorter queue "실증 준비" (active, no dates) tasks: 로컬 UI 검증, 배포 (Cloud Run + Vercel), 당일 버그 기록 양식 준비, 쉬는 날 하루 실사용; convert the existing pinned flow-sorter todo memo accordingly (memo status done, taskId set).
- realty-chart queue "광역시 확장" (planned).
- Amgi queue "Neon 리셋 후 일괄 ingest" startDate 2026-10-01 (planned), task "R114~R168 일괄 ingest".
- trading-system queue "IB+VR 데몬 점검" (active), task "IB+VR 실전 데몬 7/31 이후 미실행·주문 실패 2건 확인" (status todo).
- CXR2BC_TKR: tasks "57명 데이터 custodian 확인", "JOA 투고 준비". BrainCT_FU: "1차 평가지표 지도교수 논의".
- Project colors: add `color` field to Project (tailwind palette key), assign distinct colors in seed.

## 6. Acceptance
typecheck, tests, build pass. On :3100 at 1440×1000: home shows 3 columns without page-level horizontal scroll; papers board shows all 7 stages (empty ones collapsed) without horizontal scroll; status panel shows trading alerts (if :8899 running) and git freshness for Windows-path projects. At 390px: no horizontal page scroll; bottom nav not covering content.
Implementer: take screenshots with headless Edge (`msedge --headless=new --screenshot=... --window-size=1440,1000` and `390,1400`) of /, /papers, /projects/flow-sorter into the scratchpad path given in the brief and look at them before reporting.

## 7. Review rubric
1. Tolerant LocalRepo loader (old db.json) — no crash, defaults filled.
2. calendarEvents segment/lane math (week split, Monday start, KST).
3. Probes: server-only import boundary, 3s timeouts, never throw, no sensitive fields beyond two totals, execFile (no shell string interpolation of paths).
4. Checklist week boundary (Sunday end, KST).
5. Optimistic toggles reconcile; task sort dense per column after drag.
6. Layout: no page-level horizontal scroll at 390/1440; board columns scroll internally.
7. Note→task conversion is atomic in LocalRepo (single write).
