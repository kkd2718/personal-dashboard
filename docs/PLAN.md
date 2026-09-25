# Personal Dashboard (Command Center) — Plan

Owner: 기덕 (skdgh23@gmail.com). Planner: Opus (main session). Implementer: Sonnet (`sonnet-implement`). Advisor: Fable.
Updated: 2026-09-25

## 0. Goal
One mobile+desktop app that is (a) a quick memo/idea inbox and (b) a command center for all projects, papers,
reviews, deadlines and personal schedule, linking out to each project's own dashboard.

User works GUI-first and gives feedback by looking at the running app → **ship a runnable UI early, iterate.**

## 1. Decisions (confirmed with user)
| Topic | Decision |
|---|---|
| Hosting | Vercel (app) + **Supabase free** (Postgres + Auth + Storage). Local dashboards (trading :8899, CareNote :3000) reached via **Tailscale** links; not proxied. |
| Supabase auto-pause | Pauses after 7 days of zero DB activity (flow-sorter was down 2 months from this). Mitigation: Vercel Cron daily heartbeat write + hourly collector writes. |
| Neon | Not used (Amgi exhausted its own project quota; quotas are per project anyway). |
| Calendar | Google Calendar (phase 3). |
| Claude Code | Collect status (git, `~/.claude/projects/*/memory` on Windows **and** WSL) + send ideas to a project inbox (phase 2). |
| Sensitive data | Cloud stores links + summary numbers only (trading total/return, CareNote next date). Never procedure details or account numbers. |
| Quick capture | PWA + Web Share Target, Telegram bot, Obsidian sync. |
| Review deadlines | Gmail auto-extract via Google Apps Script (phase 3) → "needs confirmation" items. |
| Rollout | Phased (below). |

## 2. Stack
- Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, npm (pnpm not installed on Windows). Node 24.
- Dev port **3100**. Local port map (reassigned 2026-09-25): realty web 3000 / api 4000 / ops-dash 4777, CareNote 3010, Amgi 3020, flow-sorter web 3030 / api 8000, trading dashboard 8899.
- Agent budget: max 2 concurrent agents (RAM ~4GB); stop idle agents.
- Amendments after Fable review (docs/reviews/plan-advice.md): Project.paths[], Note.deliveredAt, ProjectStatus snapshot entity, Paper.submissions[], force-dynamic on D-day pages, iPhone PWA meta. Idea delivery = SessionStart hook (phase 2); iPhone capture = iOS Shortcut → /api/capture (1b) + Telegram bot (phase 2).
- Data access behind a `Repo` interface with two adapters:
  - `LocalRepo` — JSON file `./.data/db.json` (gitignored), seeded from `lib/seed.ts`. Used when `NEXT_PUBLIC_SUPABASE_URL` is unset. Lets the user see the GUI today.
  - `SupabaseRepo` — phase 1b.
- Server Actions for mutations; `revalidatePath` after writes.
- dnd-kit for kanban drag-and-drop. date-fns (+ `Asia/Seoul`) for dates. zod for input validation.
- Vitest for pure logic. No Playwright in phase 1.
- Korean UI copy. Light/dark via `prefers-color-scheme` + manual toggle.

## 3. Data model (`lib/types.ts`; same shape in SQL for 1b)
```ts
type Group = 'app' | 'research' | 'personal';
type ProjectStatus = 'active' | 'paused' | 'done' | 'archived';
interface LinkRef { label: string; url: string; kind: 'public' | 'local' | 'tailscale' | 'repo' | 'folder' }
interface Project {
  id: string; slug: string; name: string; group: Group;
  subgroup: string | null;          // e.g. 'AI', '역학', '개인연구', '사업', '재테크', '공부', '커리어'
  status: ProjectStatus; summary: string; nextAction: string | null;
  links: LinkRef[]; localPath: string | null; wsl: boolean;
  pinned: boolean; sort: number; updatedAt: string;
}
type PaperStage = 'idea' | 'writing' | 'submitted' | 'under_review' | 'revision' | 'accepted' | 'published';
interface Paper {
  id: string; title: string; shortName: string; stage: PaperStage;
  track: 'AI' | '역학' | '개인연구' | '기타';
  journal: string | null; manuscriptId: string | null; targetJournals: string[];
  folderPath: string | null;        // may lag behind stage (e.g. KnowledgeInjection_LLM published but still in 3.Revision)
  nextAction: string | null; projectId: string | null; sort: number; updatedAt: string;
}
type ReviewStatus = 'invited' | 'accepted' | 'submitted' | 'declined';
interface ReviewJob {               // manuscripts the user reviews for journals
  id: string; journal: string; manuscriptId: string | null; title: string | null;
  status: ReviewStatus; invitedAt: string | null; dueDate: string | null; // YYYY-MM-DD
  link: string | null; note: string | null; updatedAt: string;
}
type DeadlineKind = 'paper' | 'review' | 'grant' | 'thesis' | 'interview' | 'date' | 'personal' | 'other';
interface Deadline {
  id: string; title: string; kind: DeadlineKind; dueDate: string; dueTime: string | null; // 'HH:mm' KST
  projectId: string | null; paperId: string | null; reviewId: string | null;
  done: boolean; remindDays: number[];  // default [7,3,1]
  updatedAt: string;
}
type NoteKind = 'idea' | 'memo' | 'todo' | 'link';
type NoteStatus = 'inbox' | 'filed' | 'sent' | 'done' | 'archived';
interface Note {
  id: string; body: string; kind: NoteKind; status: NoteStatus;
  projectId: string | null; tags: string[]; pinned: boolean;
  source: 'web' | 'share' | 'telegram' | 'obsidian' | 'gmail' | 'collector';
  createdAt: string; updatedAt: string;
}
```
Review jobs with `dueDate` appear in the deadline views automatically (derived, not duplicated).

## 4. Pure logic (`lib/logic/*.ts`, unit-tested)
- `dday(dueDate: string, today: string): number` — calendar-day diff in KST; negative = overdue.
- `ddayLabel(n): string` — `D-3`, `D-DAY`, `D+2`.
- `urgency(n): 'overdue'|'today'|'soon'|'later'` — soon = 1..7.
- `upcoming(deadlines, reviews, today, horizonDays=30): UpcomingItem[]` — merges Deadline (not done) + ReviewJob (status invited|accepted, dueDate set) into one list sorted by due date then time; overdue first.
- `dueReminders(items, today): UpcomingItem[]` — items whose dday ∈ remindDays or ==0 or <0 (for Telegram, phase 3).
- `movePaper(papers, id, toStage, toIndex): Paper[]` — reorder within/between columns, renumber `sort` densely per stage; unknown id → unchanged.
- `parseShare({title,text,url}): {body, kind}` — url present → kind 'link', body = `title\ntext\nurl` trimmed, deduped lines.
- `groupProjects(projects): Record<Group, Record<string, Project[]>>` — by group then subgroup, archived excluded unless flag.

Tests (Vitest) — concrete cases:
- dday('2026-09-28','2026-09-25')=3; dday('2026-09-25','2026-09-25')=0; dday('2026-09-24','2026-09-25')=-1; across month/year boundary ('2027-01-01','2026-12-31')=1.
- ddayLabel(3)='D-3', (0)='D-DAY', (-2)='D+2'.
- upcoming excludes done deadlines, declined/submitted reviews, reviews without dueDate, items beyond horizon; overdue items included and first.
- dueReminders with remindDays [7,3,1]: dday 7,3,1,0,-1 included; 2 excluded.
- movePaper: move across stages keeps other columns' sort untouched and dense 0..n-1.
- parseShare: url only; text containing the url (dedupe); empty all → throws.

## 5. Screens (mobile-first; bottom nav on mobile, left sidebar ≥ md)
1. **홈 `/`** — quick-capture box (always on top); "다가오는 마감" (next 14 days, D-day chips, colored by urgency); inbox count + last 5 notes; pinned project cards; mini paper pipeline (count per stage).
2. **인박스 `/inbox`** — notes list, filters (kind, status, project, tag); each note: edit, set project (→ status 'filed'), done, archive, pin. "프로젝트로 보내기" button stubbed (phase 2 wires delivery).
3. **프로젝트 `/projects`** — tabs 앱 / 연구 / 개인, grouped by subgroup; card = name, status pill, summary, nextAction, link buttons (kind icon; `local`/`tailscale` links labeled "PC 필요"). Detail `/projects/[slug]`: fields editable, linked notes, deadlines, papers.
4. **논문 `/papers`** — kanban columns by PaperStage (horizontal scroll on mobile), drag to move; second tab **리뷰** — ReviewJob list with status + D-day, quick add (journal, ms id, due date).
5. **마감 `/deadlines`** — list grouped (지남 / 오늘 / 이번 주 / 이후) + month calendar view; add/edit/complete.
6. **공유 `/share`** — Web Share Target (GET `?title&text&url`) → creates inbox note, shows confirmation with undo.
- PWA: `app/manifest.ts` (name "Command Center", short "CC", share_target GET → `/share`), icons (simple SVG→PNG), minimal service worker only if required for installability (Next 16: manifest alone + HTTPS suffices on Chrome Android; skip SW in 1a).

## 6. Seed data (`lib/seed.ts`) — from desktop survey 2026-09-25
Projects:
- app/서비스: 동네시세 (realty-chart) — links: ops dashboard (local, `Work/realty-chart/tools/ops-dash/launch.bat`), repo github.com/kkd2718/realty_view; next: 광역시 확장.
- app/재테크: trading-system — links: 계좌 대시보드 local http://localhost:8899, repo kkd2718/trading-system; summary v3.6, GCloud VM paper trading.
- app/개인: CareNote (aesthetics-tracker) — local http://localhost:3000/people; localhost-only (민감).
- app/공부: Amgi — WSL ~/projects/amgi, repo kkd2718/amgi; note: Neon 소진, 10-01 리셋 후 일괄 ingest.
- app/사업: flow-sorter (trAIcer) — repo trAIcer-corp/flow-sorter; next: 로컬 UI 검증 → 배포.
- app/사업: personal-dashboard (this app).
- research/AI: BrainCT_FU (next: 1차 평가지표 지도교수 논의), DeepVitalSignal.
- research/역학: 학위논문 FRE-NICE g-formula (본심사 후 수정 7건), CXR2BC_TKR (57명 데이터 확인), YMC_MPH.
- research/개인연구: 연구과제(제안서/중간보고서), 특허 (CXR2BodyComposition, SimChest).
- personal/커리어: 펠로우 지원 (강남세브란스, Portfolio).
- personal/공부: Obsidian vault, 시험 우선순위 (WSL ~/prio.json).
- personal/일상: 데이트 · 약속.
- archived: quant-lab (Fable 세션이 만든 trading 게이트 실험, 결과 반영 완료).
Papers: BrainCT_FU (writing, AI), CXR2BC_TKR (writing, 역학, targets JOA→KSRR/CiOS→KSSTA→BMC MSD), DeepVitalSignal (writing, AI),
CXR2BodyComposition (under_review, AI), CXR2frailty (revision, AI), DILD (revision, AI, CMPB-S-22-00825),
KnowledgeInjection_LLM (**published**, AI, folderPath still `3.Revision`). Published folder archive not seeded individually.
Deadlines: seed none with invented dates. ReviewJobs: none. (User fills real ones.) Provide 2–3 example notes marked as examples.

## 7. Phases
- **1a (now)** — scaffold, LocalRepo, seed, all screens above, PWA manifest, logic + tests. Run on :3100 for GUI feedback.
- Repo stays **private** (user decision 2026-09-25; no public-release/PII-scrub work), but keep an **isolated design** just in case — first task of 1b:
  - `lib/seed.example.ts` (fictional sample, committed) + `data/seed.local.json` (real data, gitignored). Loader: local file if present, else example.
  - No personal constants in code (email, paths, hostnames, project names) — only in seed data or env (`ALLOWED_EMAIL`, `TRADING_URL`, etc.; documented in `.env.example`).
  - Secrets only in Vercel env / `.env.local`. `scripts/import-to-supabase` one-shot import from local seed / `.data/db.json`.
- **1b** — Supabase: SQL migration (`supabase/migrations/0001_init.sql`, RLS `owner = auth.uid()` on every table, deny anon), SupabaseRepo, magic-link login restricted to `ALLOWED_EMAIL`, Vercel deploy, `/api/cron/heartbeat` daily (CRON_SECRET) → upsert `heartbeat` row.
- **2 (addition)** — progress from repo backlog files: collector parses existing progress docs (e.g. Amgi `docs/BACKLOG.md`, realty `docs/DECISIONS.md`, per-project configurable glob) counting `- [ ]` / `- [x]` / ✅ items → ProjectActivity.metrics {backlogOpen, backlogDone}; app projects' % comes from there (no double entry). Inspired by Backlog.md.
- **2** — Collector (Node script, Windows Task Scheduler hourly, + WSL paths via `\\wsl$`): git last commit/branch/dirty per project, memory MEMORY.md digest, trading `data/state/portfolio_*.json` → summary numbers only; POST to `/api/ingest` (bearer token), write only on change. Idea dispatch: notes with status 'sent' → collector appends to `<project>/.claude/inbox.md`; plus a tiny MCP/CLI `cc inbox <slug>` for Claude sessions.
- **3** — Google Calendar sync, Telegram bot (capture + D-7/3/1 reminders), Gmail Apps Script review-deadline extraction, Obsidian two-way (vault folder `Inbox/CC`), per-project summary widgets.

## 8. Phase 1a file layout
```
app/layout.tsx, app/globals.css, app/manifest.ts
app/(main)/page.tsx, inbox/page.tsx, projects/page.tsx, projects/[slug]/page.tsx,
  papers/page.tsx, deadlines/page.tsx, share/page.tsx
app/actions/{notes,projects,papers,reviews,deadlines}.ts
components/{nav,quick-capture,note-item,project-card,paper-board,review-list,deadline-list,month-calendar,dday-chip,...}.tsx
lib/types.ts, lib/seed.ts, lib/repo/{index,local}.ts, lib/logic/{dates,upcoming,papers,share,projects}.ts (+ .test.ts)
```
`lib/repo/index.ts` exports `getRepo(): Repo` choosing adapter by env. `Repo` = CRUD per entity, async, returns plain objects.
LocalRepo: read-modify-write whole JSON with an in-process mutex; creates file from seed on first read; ids via `crypto.randomUUID()`.

## 9. Acceptance (1a)
- `npm run typecheck`, `npm test`, `npm run build` pass.
- `npm run dev` on :3100: every screen renders with seed data at 390px and 1280px widths without horizontal page scroll.
- Create note from home → appears in inbox; assign project → shows on project detail; drag paper across columns persists after reload; add review with due date → appears in 홈 다가오는 마감 with correct D-day.

## 10. Review rubric (risk-ordered)
1. D-day math uses KST calendar days, not UTC timestamps (off-by-one at 00:00–09:00 KST).
2. LocalRepo writes are atomic (temp file + rename) and serialized; no lost updates on rapid clicks.
3. Server Actions validate input with zod; no client-trusted ids beyond lookup.
4. `movePaper` keeps sort dense and stable; UI optimistic state reconciles with server.
5. Share target handles missing fields and does not create duplicates on refresh (redirect after POST-like create).
6. No secrets or sensitive values (account numbers, procedure details) in seed or client bundle.
7. Mobile layout: bottom nav doesn't cover content; kanban scrolls horizontally inside its container only.
8. Repo interface is adapter-agnostic (no fs imports leaking into client components).
