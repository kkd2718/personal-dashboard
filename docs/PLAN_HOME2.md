# Home v2 — four lanes: 개발 큐 · 논문 · 할 일 · 메모 (2026-09-26)

Baseline 5d6e288 (UX slices 1–4 shipped). Owner feedback, verbatim: "조금 직관적으로 와닿지 않는 화면들.
개발큐 / 논문 / 할 일 메모 이런게 한 눈에 들어오거나 탭이면 좋을 거 같은데 그렇게 안돼 있네".
So: the home screen is reorganized around the **four things the owner manages**, visible at once on
desktop and as **tabs** on the phone. Everything else (status, week, project activity) becomes compact
context around them. Keep all existing data/actions; this is a layout + composition change.
Design tokens/primitives from slice 1 (`components/ui/*`, globals.css) must be reused.

## Layout
### Desktop (≥ lg)
```
┌ 9월 26일 (토) · 오늘 마감 0 · 이번 주 2 · 지남 1            [메일 확인 1] [⚠ 확인 필요 3 ▾] ┐
│ [ 메모나 아이디어… @프로젝트 #태그                                                   ↵ ] │
│ 이번 주  월21 화22 수23 목24 금25 [토26] 일27   · 실증 준비 ▮▮▮  · 10/1 Neon 리셋    →   │  ← slim 1-row strip
├──────────────┬──────────────┬──────────────┬──────────────┤
│ 개발 큐    4 │ 논문       7 │ 할 일   나 3 │ 메모       4 │  ← lane headers: title, count, "전체 →"
│              │              │      봇 2    │              │
│ ● flow-sorter│ 수정  CXR2fr…│ 지남         │ Counterfact… │
│  실증 준비   │   리비전 D-12│ ☐ 논문 리비… │  BrainCT_FU  │
│  ▮▮▮▯▯ 1/4   │ 심사  CXR2Bo…│ 오늘         │  1일 전      │
│  다음: 로컬… │   심사 43일째│ ☐ 로컬 UI 검…│ …            │
│  D-5         │ 작성  BrainCT│ 이번 주      │              │
│ ● trading    │   ▸1차 평가… │ ☐ 쉬는 날 하…│              │
│  IB+VR 점검  │ ─ 리뷰 ─     │ 다음         │              │
│  ▮▯ 0/1      │ JAMA R1 D-3  │ ☐ IB+VR 실전…│              │
│ ● Amgi       │              │              │              │
│  백로그 8/12 │ + 논문       │ + 할 일      │ (capture ↑)  │
└──────────────┴──────────────┴──────────────┴──────────────┘
│ 상황 · 프로젝트 활동 (collapsed by default into the "⚠ 확인 필요 n" popover in the header) │
```
- Four equal lanes (`grid-cols-4`, gap 12), each a Card with a sticky header and its own scroll
  (`max-h: calc(100dvh - 260px)`); lanes are content-height when short (no empty stretching).
- md (768–1023): 2×2 grid, same lanes.
- The old separate 상황 card, 프로젝트 activity card, paper strip and memo strip are **removed from
  home**; their content moves into the lanes / header as described below.

### Phone (< md)
```
9월 26일 (토)                 [메일 1] [⚠ 3]
오늘 0 · 이번 주 2 · 지남 1
이번 주  21 22 23 24 25 [26] 27   (dots only, tap → calendar)
┌───────┬───────┬───────┬───────┐
│개발 큐│ 논문  │ 할 일 │ 메모  │   ← sticky segmented tabs (below header), counts as small badges
└───────┴───────┴───────┴───────┘
 (selected lane's list, full width)
```
- Default tab **할 일**. Selected tab persisted in localStorage (try/catch) and in `?tab=` (so a link
  from Telegram/⌘K can open a lane). Horizontal swipe between tabs is optional — only if it's
  trivial and doesn't fight vertical scroll; tabs are enough.
- `⚠ n` chip opens a bottom Sheet with status items (critical/warn first, "그 외 n개 정상" collapsed) and
  the project activity list.

## Lanes (content + actions)
1. **개발 큐** (queues = active `Milestone`s across projects; group `app` first, then research/personal):
   one card per active queue: project color dot + project name, queue title, progress bar with
   `progressLabel` (`할 일 1개` below 3 tasks → no bar; `2/5 완료`), next undone task title (`다음: …`),
   D-day chip if the queue has an end date, agent-task count badge (`봇 2`) if any open agent tasks.
   Projects with backlog metrics and no active queue show one card with `백로그 8/12` bar.
   Also include projects with a `nextAction` but no queue as a light row (`다음: …`).
   Card click → project detail. Header "전체 →" → /projects. Empty: "진행 중인 큐가 없어요" + `+ 큐` (links to projects).
2. **논문**: papers grouped by stage in pipeline order but only non-empty stages, compact rows:
   stage chip · short name · one meta line (`paperCardLine` from slice 3: 리비전 D-n / 심사 n일째 / ▸ next action).
   Below a divider `리뷰`: open ReviewJobs with due D-day. Pending mail candidates → amber row at the top
   `메일 확인 n →` (/papers?tab=review). Row click → /papers (opening the paper detail sheet if feasible via
   `?paper=<id>`; otherwise just /papers). Footer `+ 논문`.
3. **할 일**: the existing ChecklistPanel content (나/봇 toggle, 지남/오늘/이번 주/진행 중/다음 sections,
   empty sections hidden, today's Google events inline, optimistic toggle, `+ 할 일`). Reuse the component;
   only strip its outer chrome so it fits the lane.
4. **메모**: latest non-archived memos (max 12), one line each with kind icon, stripped body, project chip,
   relTime; row click → /memo. On phone the lane starts with the capture box (desktop already has it in
   the header). Footer "전체 →".

## Header
- Date + counts sentence (existing `headerCountLabel`), `메일 확인 n` chip (existing), and a new
  `⚠ 확인 필요 n` chip = critical+warn status items count (hidden when 0; neutral "모두 정상" text instead).
  Desktop: chip opens a Popover (340px) with StatusPanel content + project activity list (reuse
  ProjectProgressList rows but without its card chrome). Phone: Sheet.
- Week strip: reuse WeekStrip in a **slim** single-row variant (prop `compact`): day numbers + dots, the
  first 2 queue ranges as tiny labels, agenda hidden; "캘린더 →" link. The 주/월 toggle is removed from home
  (month view lives on /calendar).

## Also (same slice)
- Sidebar/tab naming stays, but the 프로젝트 page title gets a subtitle "개발 · 연구 · 개인" for orientation.
- ⌘K: add "이동: 개발 큐 / 논문 / 할 일 / 메모" entries that open home with `?tab=`.
- Delete now-unused home-only components only if nothing else imports them.

## Gate
typecheck, lint, tests (add unit tests for any new pure helpers, e.g. building lane rows from
milestones/tasks/papers — put them in lib/logic/home.ts), build, isolation. No new deps.
Don't commit/push (push = deploy). Headless screenshots don't work in the agent sandbox — the planner
does the visual review.
