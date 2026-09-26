# Phase 1d — memos everywhere, me/agent checklist, calendar add (2026-09-25)

Baseline: commit f8fd8ba (1c). LocalRepo. Conventions: docs/PLAN.md, docs/PLAN_1c.md, CLAUDE.md. This file overrides where different.

## User feedback
1. Checklist must separate **what I check** vs **what agents (Claude sessions) check**.
2. Home needs a place to write/see **my memos**.
3. Calendar: click a day to add a **memo/note** (also task/deadline).
4. Memos/ideas must be **taggable to an item** (e.g. research idea → BrainCT_FU) plus free tags.

## 1. Data model
```ts
type Assignee = 'me' | 'agent';
interface Task { ...; assignee: Assignee }           // default 'me'
interface Note { ...; date: string | null }          // YYYY-MM-DD: memo pinned to a calendar day
```
- Tolerant loader: missing `assignee` → 'me'; missing `date` → null.
- Note already has `projectId` and `tags: string[]`. Tags are normalized: trimmed, no leading '#', lowercased for comparison but displayed as entered (store as entered; compare case-insensitively). Kind stays ('idea'|'memo'|'todo'|'link').
- Agent tasks are what phase 2's SessionStart hook will deliver to that project's Claude session (document this in CLAUDE.md). In 1d the user can still tick them manually.

## 2. Pure logic (tested)
- `parseCapture(text, projects): { body: string; projectId: string | null; tags: string[]; kind: NoteKind }`
  - `#태그` tokens (unicode letters/digits/_/-; stop at whitespace/punctuation) → tags, removed from body? **Keep them in body text** (don't mutate what the user wrote) but also collect into tags, deduped case-insensitively.
  - `@token` → match project by slug or name, case-insensitive, ignoring spaces/underscores/hyphens (`@brainct`, `@BrainCT_FU`, `@브레인` no). First match wins; unmatched `@token` stays plain text.
  - Leading `!` or `아이디어:` → kind 'idea'; leading `[ ]` → 'todo'; body with URL only → 'link'; else 'memo'.
- `checklist(...)` gains assignee split: returns `{ me: Buckets; agent: Buckets }` where Buckets = the existing `{overdue,today,thisWeek,doing,next}`. Deadlines and reviews go to `me` only.
- `calendarEvents` points include notes with `date` (kind 'memo').
- `filterNotes(notes, {projectId?, tag?, status?})` for home/memo pages.

Tests: parseCapture cases — `"@brainct #연구아이디어 counterfactual RL"` → projectId brainct-fu, tags ['연구아이디어'], kind memo; `"! 새 앱"` → idea; `"@unknown hi"` → projectId null; duplicate tags `#A #a` → one; URL-only → link. Checklist split: agent task not in `me`; review always in `me`. calendarEvents includes dated note.

## 3. UI
**Quick capture (home top, also memo page)**: single-line input that grows to textarea on focus; below it (when focused) a row: project picker combobox (search over active projects incl. research items; shows color dot), kind segmented control (메모/아이디어/할 일), tag chips (type + Enter), optional date. Inline `@`/`#` parsing fills the picker/chips live (preview chips). Submit: Ctrl/⌘+Enter or button. If kind 'todo' and a project is chosen → create Task (assignee me) instead of Note.

**Home layout** (keep 3 columns):
- Left: **체크리스트** with a segmented toggle **나 / 에이전트** (counts in each tab label, e.g. "나 5 · 에이전트 3"); default 나. Agent rows show a small bot icon; "+ 할 일" form has assignee toggle.
- Center: calendar (top) → **메모** panel (below): recent 12 open memos (status inbox|filed), filter chips by project (only projects that have memos) + "태그" dropdown; each memo row: project color chip, tags, kind icon, relative time; click → inline edit (body, project, tags, date); actions: 할 일로 전환, 완료, 보관. "전체 보기 →" /memo.
- Right: unchanged (status, progress).
- Mobile order: capture → urgent status → checklist → memo panel → calendar → progress.

**Calendar (home + /calendar)**: clicking a day cell opens a small popover anchored to the cell: tabs 메모 / 할 일 / 마감, each a minimal form (memo: body + project picker + tags; task: title + project + assignee; deadline: title + kind + time). Day cell shows memo points (note icon). Clicking an existing point opens its edit popover (or navigates for tasks → project page).

**Memo page `/memo`**: tag filter (all tags with counts), project filter, kind filter; group by date (오늘/어제/이번 주/이전).

**Project detail**: "메모 · 아이디어" section lists notes with that projectId (newest first) with the same quick-capture preset to this project.

## 4. Seed
Assign assignee: flow-sorter 로컬 UI 검증=me, 배포=agent, 당일 버그 기록 양식 준비=agent, 쉬는 날 하루 실사용=me; trading IB+VR 점검=me; Amgi ingest=agent; CXR2BC_TKR both=me; BrainCT_FU=me. Add one real-shaped example memo tagged to brainct-fu: body "@brainct #연구아이디어 Counterfactual Calibration RL 후속 논문 스코프" (from user's memory notes; mark not example), kind idea.

## 5. Acceptance
typecheck, lint, tests pass; build ok. Manual (screenshots 1440×1000 of /, /memo, /projects/brainct-fu, /calendar with a day popover open if feasible): checklist toggle 나/에이전트 works; memo from home with `@brainct #연구아이디어` appears in home memo panel and on BrainCT_FU project page with tag chip; calendar day click adds a memo that shows as a point after reload.

## 5b. Addendum (user feedback, same round)
- `@`/`#` autocomplete: caret dropdown, Tab/Enter accept, Esc close; `@` fuzzy over name/slug/`Project.aliases`; `#` over existing tags by usage, normalized (lowercase, strip spaces/_/-) so variants resolve to one tag; new tag only via explicit "새 태그 만들기" or no-match + space.
- Tag hygiene on /memo: rename / merge tags (atomic). Project aliases editable.
- Home grid: row 1 [checklist | calendar | status] equal height (viewport-capped, internal scroll); row 2 [memo (col-span-2) | progress] equal height; consistent panel chrome.

## 6. Rubric
1. parseCapture never loses user text; tag dedupe case-insensitive; `@` matching tolerant but no false positives.
2. Tolerant loader defaults (assignee, date).
3. Popover accessibility: Esc closes, focus returns, works with touch (no hover-only).
4. Checklist split correctness (deadlines/reviews only in me).
5. No regressions in 1c tests; status probes untouched.
