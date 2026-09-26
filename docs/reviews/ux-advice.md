# Command Center — product/UX spec (advice, 2026-09-26)

Advisor: Fable. Audience: Opus (planner) → Sonnet (implementer). Scope: UI/UX only; no data-model
changes except the few flagged `DATA:` items. Screenshots reviewed: light/dark × desktop 1440 /
mobile 390, all 8 routes. Codebase skimmed: `components/*.tsx`, `app/(main)/**`, `app/globals.css`,
`lib/types.ts`, `lib/status/*`, `lib/logic/checklist.ts`.

Verdict in one line: the app has the right *bones* (capture → memo → task → queue, papers, reviews,
calendar, collector) but every screen currently renders **storage**, not **answers**. The work below
is mostly presentation: fewer boxes, sentences instead of key=value, hide what is empty, humanize time,
and give the phone a real thumb-first layout.

---

## 1. Product principles

1. **Home answers "지금 뭐 하지?" in 3 seconds.** Above the fold, in this order: what is due/overdue,
   what is blocked or broken, what I was doing last. Nothing else competes (no progress bars, no tag
   selects, no month grid) until below the fold.
2. **Sentences, not telemetry.** Any machine-derived fact (git, daemon, collector, Gmail) is rendered as
   a short Korean sentence with a relative time: "3일 전 커밋 · 미커밋 변경 있음", never
   `last_run=2026-07-31`, never "644시간 전", never "0/1 (0%)".
3. **Empty means invisible.** A section with nothing in it collapses to nothing (or one line with one
   action). Never render "지남 (0) 없음" ×4. Never a full-height empty kanban column.
4. **One capture box, parsed.** `@프로젝트 #태그` are typed once and shown as chips forever; the raw
   tokens never appear in a rendered memo body.
5. **Quiet by default, loud when it matters.** Color carries meaning only for *overdue / today /
   critical*. Everything else is neutral. In dark mode status is a tinted border + text, never a
   solid orange slab.

---

## 2. Information architecture & navigation

### Routes (final)
| Route | Name | Change |
|---|---|---|
| `/` | 홈 | Rebuilt around "오늘" (§5.1) |
| `/memo` | 메모 | Instant filters, hover actions, parsed chips |
| `/projects` | 프로젝트 | Row list on desktop, cards on mobile; no per-subgroup grid |
| `/projects/[slug]` | 프로젝트 상세 | Header + 지금 + 큐/할 일; settings moved to an edit sheet |
| `/papers` | 논문 | Kanban (desktop) / stage list (mobile); card detail panel |
| `/papers?tab=review` | 리뷰 | Candidates panel with sentence headlines |
| `/calendar` | 캘린더 | Contrast, per-calendar chips, add via popover; no bottom form |
| `/settings` | **NEW: 설정** | Integrations status, export, theme, logout, build info |
| `/login` | 로그인 | Centered card, polish only |
| `/inbox`, `/deadlines`, `/share` | — | Keep redirects; `/share` unchanged |

### Desktop sidebar (≥ md, 224px)
```
 ▣ Command Center        ← wordmark; click = home
 ─────────────────
 ⌂ 홈                     g h
 ✎ 메모            (3)    g m   ← inbox-status count badge, muted
 ▤ 프로젝트                g p
 ▥ 논문            (2)    g l   ← pending mail candidates badge (amber dot, not number, when >0)
 ▦ 캘린더                  g c
 ─────────────────
 ⌘K 검색·명령              ← real button, opens palette
 ⚙ 설정        ☾  ⇥       ← settings link, theme, logout in one row
```
Remove the "Phase 1b" label. Build info lives in 설정 (`NEXT_PUBLIC_COMMIT_SHA`/deploy time).

### Mobile bottom nav (< md) — 4 tabs + centered capture
```
 ┌──────┬──────┬──────┬──────┬──────┐
 │  ⌂   │  ✎   │ (+)  │  ▤   │  ▦   │
 │  홈  │ 메모 │      │프로젝트│캘린더│
 └──────┴──────┴──────┴──────┴──────┘
```
- `(+)` is a raised 52px circle (accent) that opens the **capture sheet** (§4.6) from any page.
  Capture is the app's #1 mobile action; it must be reachable without scrolling to the top.
- 논문 is not a tab on the phone: it is reached from the 프로젝트 page's top segmented control
  `프로젝트 | 논문 | 리뷰` (mobile only) and from the home 논문 strip. Rationale: kanban is a desktop
  activity; on the phone papers are read/checked, not dragged. Desktop keeps 논문 in the sidebar.
- 설정 on mobile: gear icon in the home header (top-right).
- Tab height 56px + safe-area; icons 22px, labels 11px; active = accent color + 2px top indicator.

### Home above the fold

**Desktop 1440 (sidebar 224 + content 1216, 3 columns 5/4/3 of 12)**
```
┌───────────────────────────────────────────────────────────────────────────────┐
│ 9월 26일 토요일   ·   오늘 마감 0 · 이번 주 2 · 지남 1        [PC 기준 15:09 ↻] │
│ ┌───────────────────────────────────────────────────────────────┐  ⌘K       │
│ │ ✎ 메모나 아이디어… @프로젝트 #태그                          ↵ │            │
│ └───────────────────────────────────────────────────────────────┘            │
├────────────────────────────┬──────────────────────┬────────────────────────────┤
│ 오늘                 나│봇 │ 이번 주   ‹ 9/21–27 › │ 상황                      │
│ ▸ 지남 1                    │ 월 화 수 목 금 토 일  │ ● IB+VR 데몬이 8주째 안   │
│  ☐ ● 논문 리비전 제출  D+2  │ 21 22 23 24 25 26 27  │   돌아요 · 예정 9/28    → │
│ ▸ 오늘 · 일정 2             │ ──▮▮▮▮▮▮▮▮──  실증 준비│ ● CareNote 30일째 커밋   │
│  14:00 랩미팅 (연구실)      │  ·   ·  ▪   ▪         │   없음 · 미커밋 변경    → │
│  ☐ ● 로컬 UI 검증           │ [오늘: 랩미팅 14:00]  │ ● flow-sorter 30일째 …  → │
│ ▸ 이번 주                   │ [토: Neon 리셋 ingest]│ ─ 그 외 4개 정상 ▾        │
│  ☐ ● 쉬는 날 하루 실사용 D-3│                        │                            │
│ ▸ 다음 (진행 중인 큐)       │                        │ 최근 활동                  │
│  ☐ ● IB+VR 실전 데몬 …      │                        │ ● 동네시세  방금 세션      │
│                              │                        │ ● personal-dashboard 1h    │
│ + 할 일                      │ 캘린더 전체 →          │ ● trading-system 4시간 전  │
├────────────────────────────┴──────────────────────┴────────────────────────────┤
│ 메모  전체 3 · BrainCT_FU 1                                   전체 보기 →      │
│ ● 아이디어  Counterfactual Calibration RL 후속 논문 스코프  [BrainCT_FU][#연구아이디어] 1일 전 │
│ ● 할 일    flow-sorter 실증 — 쉬는 날 하루 클리닉…  [flow-sorter][#실증]  → 할 일로 전환됨 │
├───────────────────────────────────────────────────────────────────────────────┤
│ 논문  작성중 3 · 심사중 1 · 수정 2 · 출판 1        ⚠ DILD 리비전 D-12   전체 → │
└───────────────────────────────────────────────────────────────────────────────┘
```
Rules: the three columns are `min-h` not fixed-height; each grows to content, capped at 60vh with
inner scroll. Empty `▸` groups are omitted entirely. 진행률 panel is **removed** from home
(replaced by the "최근 활동" list under 상황, which shows a *sentence* per active project, sorted by
last session/commit desc, capped at 6).

**iPhone 390 (standalone PWA)**
```
┌──────────────────────────────┐
│ 9월 26일 토           ⚙  ☾   │  ← header 44px, no capture box here
│ 오늘 0 · 이번 주 2 · 지남 1  │
├──────────────────────────────┤
│ ● IB+VR 데몬이 8주째 안 돌아요│  ← 상황: critical/warn only, max 3, "+2 더" link
│ ● CareNote 30일째 커밋 없음   │
├──────────────────────────────┤
│ 오늘                    나│봇 │
│ ▸ 지남 1                      │
│  ☐ 논문 리비전 제출      D+2  │  ← row 48px, checkbox 24px hit 44px
│ ▸ 오늘 · 일정 2               │
│  14:00 랩미팅                 │
│  ☐ 로컬 UI 검증               │
│ ▸ 이번 주                     │
│  ☐ 쉬는 날 하루 실사용   D-3  │
│ ▸ 다음                        │
│  ☐ IB+VR 실전 데몬 7/31 이후… │
├──────────────────────────────┤
│ 이번 주  21 22 23 24 25 [26] 27│  ← 7-day strip, dots only, tap → calendar day sheet
│ ▮▮▮▮▮ 실증 준비                │
├──────────────────────────────┤
│ 메모 (3)              전체 → │
│ ● Counterfactual Calib…  1일 전│
│ ● flow-sorter 실증 — …  어제  │
├──────────────────────────────┤
│ 논문  작성 3 · 심사 1 · 수정 2 │
└──────────────────────────────┘
        ⌂    ✎   (+)   ▤    ▦
```
Acceptance: at 390px, `document.documentElement.scrollWidth === window.innerWidth` on every route
(the current mobile home overflows horizontally: 진행률 "0/1 (0%" and checklist rows are clipped —
audit for missing `min-w-0` on flex children and fixed-width week grids).

### Project detail (desktop; mobile stacks the same order)
```
┌───────────────────────────────────────────────────────────────┐
│ ● 동네시세 (realty-chart)   [진행중 ▾]            ✎ 편집   ⋯   │
│ 앱 · 서비스  ·  동네 단위 실거래가 시세 서비스                  │
│ 오늘 커밋 (master) · 미커밋 변경 있음 · 마지막 세션 방금       │
│ [🖥 운영 대시보드 PC] [⎇ GitHub] [📁 경로 복사]               │
├───────────────────────────────────────────────────────────────┤
│ 지금                                                          │
│ ┌ 다음 액션 ───────────────────────────────────────── ✎ ┐    │
│ │ 광역시 확장                                            │    │
│ └────────────────────────────────────────────────────────┘    │
│ 큐  [광역시 확장 · 예정 · 0/1] [+ 큐]                          │
├───────────────────────────────────────────────────────────────┤
│ 할 일   전체 | 광역시 확장          나 1 · 에이전트 0   + 할 일 │
│ ┌ 할 일 1 ──────┐ ┌ 진행 중 ──────┐ ┌ 완료 ─────────┐          │
│ │ 광역시 확장…  │ │  (비어 있음)  │ │  (비어 있음)  │          │
│ └───────────────┘ └───────────────┘ └───────────────┘          │
├───────────────────────────────────────────────────────────────┤
│ 마감 · 논문 · 메모   (each section only if non-empty; memo     │
│  section keeps a compact capture box pre-scoped to @project)   │
└───────────────────────────────────────────────────────────────┘
```
- The settings form (상태/요약/별칭/백로그 파일 + paths/links/color) moves into an **edit sheet**
  opened by ✎ 편집. Absolute Windows paths are never printed; "경로 복사" copies `paths[0]` and the
  tooltip shows it.
- Mobile task board: three columns become a segmented control `할 일 1 | 진행 중 0 | 완료 0` over a
  single list; move via row ⋯ menu (no horizontal drag on phone).

### Papers (desktop kanban)
```
 파이프라인 | 리뷰 ●                                       + 논문   ⌘K
┌ 작성중 3 ─────────┐┌ 심사중 1 ─────────┐┌ 수정 2 ──────────┐┌ 출판 1 ──────┐
│ BrainCT_FU        ││ CXR2BodyComposi…  ││ CXR2frailty       ││ KnowledgeInj…│
│ AI · 초안         ││ AI · Radiology    ││ AI · Eur Radiol   ││ AI · JMIR    │
│ ▸ 1차 평가지표 …  ││ 심사 42일째        ││ ⚠ 리비전 D-12     ││ 2026-03 출판 │
├───────────────────┤├───────────────────┤├───────────────────┤└──────────────┘
│ CXR2BC_TKR        ││                   ││ DILD              │
│ 역학 · 투고 1회    ││                   ││ AI · CMPB         │
│ ▸ 57명 데이터 확인 ││                   ││ ⚠ 리비전 기한 없음 │
└───────────────────┘└───────────────────┘└───────────────────┘
 빈 단계: 아이디어 · 투고 · 게재확정   (drop a card here to move)
```
Empty stages render as one **footer chip row**, each chip a droppable target that expands into a
column only while a drag is in progress. No vertical text.

### Calendar (desktop)
```
 ‹ 2026년 9월 ›  오늘     [월|주]   ○ 개인 ● 교수님 ○ 랩 공유    + 추가
┌────────┬────────┬────────┬────────┬────────┬────────┬────────┐┌ 다가오는 30일 ┐
│ 월 31  │ 화 1   │ 수 2   │ 목 3   │ 금 4   │ 토 5   │ 일 6   ││ 9/28 일        │
│        │        │        │        │        │        │        ││  ● IB+VR 예정  │
│▮▮▮▮▮▮▮▮▮▮▮▮ 실증 준비 (flow-sorter) ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮││ 10/1 목        │
│        │ ◦14:00 │        │        │        │        │        ││  ● Neon 리셋…  │
│        │ 랩미팅 │        │        │        │        │        ││ 10/15 목       │
├────────┼────────┼────────┼────────┼────────┼────────┼────────┤│  ⚠ DILD 리비전 │
│ …      │        │        │        │        │ [26]   │ 27 🔴  ││  D-19          │
│        │        │        │        │        │ 오늘   │ 휴일   ││                │
└────────┴────────┴────────┴────────┴────────┴────────┴────────┘└────────────────┘
```
Queue bars: 6px tall, project color at 70% opacity, label inside on the first segment. Google events:
outline chip with `◦ HH:mm 제목`. Deadlines/reviews: solid chip with D-day. Max 3 chips per cell then
`+n`. Mobile defaults to **week** view with the day list underneath (agenda), not a month grid.

---

## 3. Design system

### Font
- **Pretendard Variable** via the jsDelivr **dynamic-subset** CSS (Korean glyphs split into ~100
  small woff2 chunks, only used ones download):
  `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css`
  Load with a `<link rel="preconnect">` + `<link rel="stylesheet">` in `app/layout.tsx`.
  Constraints: `next/font/google` does not carry Pretendard; `next/font/local` can self-host
  `PretendardVariable.woff2` (~2 MB, one file — too heavy for phone first paint, and it cannot do
  dynamic subsetting). If the CDN is unacceptable later, switch to `next/font/local` with the
  `pretendard-std` subset (~600 KB) — same CSS variable, no other change.
- Stack: `"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR",
  system-ui, sans-serif`. Expose as `--font-sans`; set `font-feature-settings: "tnum"` on any numeric
  column (D-day, counts, times) via a `.tnum` utility.
- Mono for manuscript ids / paths only: `ui-monospace, "SF Mono", Menlo, monospace` (`--font-mono`).
- Korean line-height: body 1.55, headings 1.3. `word-break: keep-all` on headings and chips so
  Korean words don't split mid-word; `overflow-wrap: anywhere` on memo bodies.

### Type scale (rem; desktop / mobile)
| Token | Size | Weight | Use |
|---|---|---|---|
| `text-xs` | 12 / 12 | 400 | meta, timestamps, chips |
| `text-sm` | 13 / 14 | 400 | body in dense lists, card secondary |
| `text-base` | 14 / 15 | 400 | default body, memo text |
| `text-md` | 15 / 16 | 500 | row titles, card titles |
| `text-lg` | 18 / 18 | 600 | section titles (오늘, 상황) |
| `text-xl` | 22 / 20 | 600 | page title |
- **Inputs on mobile must be ≥ 16px** (`text-[16px]` at `< md`) or iOS zooms on focus.

### Spacing, radius, elevation
- Spacing scale: 4 · 8 · 12 · 16 · 20 · 24 · 32. Page gutter 16 (mobile) / 24 (desktop). Card padding
  12 (desktop) / 14 (mobile). Gap between cards 12; between sections 24.
- Radius: `--r-sm` 6 (chips, buttons, inputs), `--r-md` 10 (cards, rows), `--r-lg` 14 (sheets,
  dialogs, popovers), `9999` pills.
- Elevation, light: cards are **flat** (1px `--border`, no shadow). Popover:
  `0 4px 16px rgba(16,24,40,.10)`. Sheet/dialog: `0 12px 40px rgba(16,24,40,.18)`. Drag overlay:
  popover shadow + `scale(1.02)`.
- Elevation, dark: **no shadows**; raise by surface step (`surface` → `surface-2` → `surface-3`) and a
  slightly lighter border.

### Color tokens (`:root` / `.dark`; keep the existing `@theme inline` mapping and add these)
| Token | Light | Dark | Notes |
|---|---|---|---|
| `--bg` | `#f6f7f9` | `#0f1216` | page canvas |
| `--surface` | `#ffffff` | `#171b21` | cards |
| `--surface-2` | `#f1f3f6` | `#1d222a` | inset areas (kanban columns, code) |
| `--surface-3` | `#e9ecf1` | `#242a34` | popovers/sheets in dark |
| `--border` | `#e4e7ec` | `#2a303a` | |
| `--border-strong` | `#cfd4dc` | `#3a4250` | inputs focus ring base, dividers in dense lists |
| `--fg` | `#101828` | `#e6e9ef` | |
| `--fg-2` | `#475467` | `#a7b0be` | secondary text (≥ 4.5:1 on surface) |
| `--fg-3` | `#98a2b3` | `#6b7584` | placeholders, meta (≥ 3:1 only — never for essential text) |
| `--accent` | `#2f6fed` | `#6ea0ff` | primary actions, active nav, links |
| `--accent-soft` | `#eaf1fe` | `rgba(110,160,255,.14)` | selected backgrounds |
| `--danger` / `--danger-soft` | `#d92d20` / `#fee4e2` | `#f97066` / `rgba(249,112,102,.12)` | overdue, critical |
| `--warn` / `--warn-soft` | `#b54708` / `#fef0c7` | `#f5b74a` / `rgba(245,183,74,.12)` | today, D-1..3, warn |
| `--success` / `--success-soft` | `#067647` / `#dcfae6` | `#5ccb8a` / `rgba(92,203,138,.12)` | done, fresh, ok |
| `--info` | = accent | = accent | "soon" (D-4..7), sent-to-agent |
- **Dark-mode status rule:** severity is shown by a 3px left border in the semantic color + tinted
  text; background stays `--surface` (or `-soft` at ≤ 14% alpha). The current solid brown/orange
  warn boxes on dark home are the single loudest thing in the app — remove.
- Project accent colors (`lib/project-colors.ts`) stay, but at **500 for dots/bars in light, 400 in
  dark**, and the `chip` background at 12% alpha in dark instead of the `-950` shades (which read
  muddy).
- Focus ring: `0 0 0 2px var(--bg), 0 0 0 4px var(--accent)`; visible only for `:focus-visible`.

### Density
- Rows: 36px desktop / 48px mobile minimum; checkbox hit area 44×44 on touch.
- Chips: 22px tall, 12px text, 8px horizontal padding, max one icon.
- Never more than **two** lines of meta under a title in a list row; the rest lives in a detail
  panel/sheet.

### Iconography
- lucide-react only, stroke 1.75. Sizes: 14 in chips, 16 in rows/buttons, 18 sidebar, 22 bottom nav.
- Fixed vocabulary (don't mix): 메모 `StickyNote`, 아이디어 `Lightbulb`, 할 일 `SquareCheck`,
  마감 `CalendarClock`, 리뷰 `FileCheck`, 논문 `FileText`, 큐 `ListOrdered`, 에이전트 `Bot`,
  Google 일정 `CalendarDays`, PC 필요 `Monitor`, 저장소 `GitBranch`, 보냄 `Send`.

### Motion
- Durations: 120ms (hover/press), 160ms (fade/chip), 220ms (sheet/popover), easing
  `cubic-bezier(.2,.8,.2,1)`. Skeleton shimmer 1.4s linear.
- Sheets slide from bottom (mobile) / fade+2px rise (desktop popovers).
- `@media (prefers-reduced-motion: reduce)`: all transforms → none, durations → 0, shimmer → static.
- No layout-shifting animations on load; optimistic updates animate only opacity/strike-through.

---

## 4. Interaction patterns

### 4.1 Command palette (⌘K / Ctrl+K, and the sidebar button)
Scope, in this order, fuzzy-matched over a **static index passed from the server** (dataset is tiny;
no search API, no `cmdk` dependency required — a 150-line component is enough):
1. **이동** — pages (홈/메모/프로젝트/논문/리뷰/캘린더/설정), every project (`name`, `aliases`,
   `slug`), every paper (`shortName`, `title`), every open review (`journal manuscriptId`).
2. **만들기** — `메모: <text>` (typing free text with no match shows this as the first row; ↵ creates
   through `createNoteAction`), `할 일: <text>`, `마감: <text>` (opens the date popover after ↵).
3. **동작** — 테마 전환, 상황 새로고침, JSON 내보내기, 로그아웃.
Rows: icon + label + right-aligned kind chip; ↑↓ ↵ Esc; max 8 visible. Mobile: opened from the
home header search icon, rendered as a full-height sheet.

### 4.2 Keyboard shortcuts (desktop; ignored when focus is in an input)
`⌘K` palette · `c` focus capture · `g h/m/p/l/c` go to page · `?` shortcut sheet · `Esc` close ·
in checklist: `j/k` move, `x` toggle done · in kanban: `←/→` on a focused card moves stage (a11y
fallback for drag). Nothing else.

### 4.3 Inline / hover actions
- Memo, task, deadline, review rows: actions are **hidden until hover or `:focus-within`** on
  desktop; on touch they live behind a `⋯` button (44px) that opens a bottom sheet action list.
- Each row has exactly **one visible primary action** chosen by state (memo: 프로젝트 지정 → 프로젝트로
  보내기 → 보냄 ✓; task: checkbox; candidate: 추가). Everything else is secondary.
- Inline edit: click title text → editable field, `↵` saves, `Esc` cancels, blur saves. Used for
  memo body, task title, project nextAction, paper nextAction.

### 4.4 Optimistic updates, toasts, undo
- All toggles/moves/archives update local state immediately (checklist already does this; extend to
  memo status, candidate accept/dismiss, deadline done, paper stage).
- One global toast host (`components/toast.tsx`, context + `useToast()`), bottom-center on desktop,
  above the bottom nav on mobile. Max 1 visible, 4s, pauses on hover. Variants: default, success,
  danger. Optional **action** button.
- Undo for destructive-ish actions: 메모 보관/완료, 할 일 완료, 논문 단계 이동, 메일 후보 무시, 마감
  완료. Implementation: toast `실행 취소` calls the inverse action with the pre-change snapshot; no
  new server endpoints needed (all inverses exist as update actions).
- Server failure → revert local state + danger toast "저장하지 못했어요. 다시 시도해 주세요."

### 4.5 Empty states, skeletons
- Every panel/page has a **one-line empty state + one action**, phrased as an invitation:
  - 오늘: "오늘은 비어 있어요." [+ 할 일]
  - 메모: "아직 메모가 없어요. 떠오른 생각을 적어보세요." (capture box already above → no button)
  - 상황: "모두 정상이에요 · PC 기준 15:09"
  - 마감/캘린더 다가오는: "30일 안에 마감이 없어요." [+ 추가]
  - 리뷰 후보: panel hidden entirely when 0 (already).
- Skeletons: `loading.tsx` for `/`, `/memo`, `/projects`, `/projects/[slug]`, `/papers`, `/calendar`
  with the same card silhouettes (rounded blocks, 3–5 rows). Since these routes are `force-dynamic`,
  this is what the user sees on every cold navigation on the phone — it matters.

### 4.6 Mobile sheets and tap targets
- `components/sheet.tsx`: portal, backdrop, drag handle, `max-h-[85dvh]`, safe-area bottom padding,
  Esc/backdrop/handle-drag to close, focus trap, restores focus. Used for: capture (FAB), row `⋯`
  actions, paper detail, project edit, calendar day, add deadline, ⌘K.
- Capture sheet = the existing `QuickCapture` with the textarea auto-focused, kind chips
  (메모/아이디어/할 일), project chip picker, and the mention popover. Submitting closes the sheet and
  shows a toast "메모 저장됨 · BrainCT_FU" with `보기`.
- All tappables ≥ 44×44; list rows ≥ 48px; bottom nav never overlaps content (`pb` = nav + safe area —
  already done; keep).
- **No pull-to-refresh.** Instead: on `visibilitychange` → visible, if the page was rendered > 5 min
  ago, call `router.refresh()` and show a 1-line "업데이트됨" toast only if data changed. Add a tap
  target on "PC 기준 15:09" that refreshes status (exists; make it 44px).

---

## 5. Page-by-page

### 5.1 홈 `/`
- [ ] Header line: `M월 D일 요일` + count sentence `오늘 n · 이번 주 n · 지남 n` (n>0 parts only;
      all zero → "이번 주 마감 없음"). Right: `PC 기준 HH:MM ↻` (or `마지막 확인` when local) and
      the 메일 확인 chip when candidates > 0. Mobile: capture box removed from the header (FAB).
- [ ] **오늘 panel** replaces 체크리스트: sections 지남 / 오늘 / 이번 주 / 진행 중 / 다음 rendered
      **only if non-empty**; today's timed Google events appear inside 오늘 as read-only rows
      (`HH:mm 제목`, `CalendarDays` icon). 나/에이전트 toggle stays (rename 봇 → 에이전트 is fine).
      Acceptance: with zero tasks, the panel is one empty-state line, not four "없음".
- [ ] **이번 주 panel** replaces the month calendar on home: 7-day strip + queue bars + up to 4 chips
      per day, `캘린더 전체 →`. Desktop keeps `월|주` toggle defaulting to 주.
- [ ] **상황 panel**: items are sentences (§6). Only `critical`/`warn` shown open; `info`/`ok` collapse
      under "그 외 n개 정상 ▾". Each item is a link to its project when `projectId` is set. Beneath it,
      **최근 활동**: active projects as one sentence each ("● 동네시세 · 방금 세션 · 오늘 커밋"),
      sorted by recency, max 6. 진행률 panel removed from home.
- [ ] **메모 strip**: compact rows (kind dot · body first line · project chip · tag chips · relTime),
      max 5, no per-row controls (click → memo page with that note focused). Filter chips are removed
      from home.
- [ ] **논문 strip**: `작성중 3 · 심사중 1 · 수정 2 · 출판 1` + any revision deadline with D-day ≤ 30
      as a warn chip. Links to `/papers`.
- [ ] Acceptance: desktop 1440 — everything in §2 "above the fold" is visible without scrolling at
      900px viewport height; mobile 390 — no horizontal scroll, first screen shows header + 상황 +
      first 4 오늘 rows.

### 5.2 메모 `/memo`
- [ ] Remove the 태그 관리 card; tags become a `태그 ▾` popover next to the filters (rename/merge
      inside it).
- [ ] Filters become **instant** chips/selects that update `?kind=&status=&project=&tag=` via
      `router.replace` (no "필터 적용" button). Active filters shown as removable chips; "초기화".
- [ ] Note card: header row = kind chip + project chip (color dot) + tag chips + relTime; body renders
      with `@`/`#` tokens **stripped** (they are already parsed into `projectId`/`tags`; `DATA:` if the
      body currently keeps the raw tokens, strip at render with the existing `parseCapture` regex —
      do not rewrite stored bodies). Controls hidden until hover/focus-within; mobile `⋯` sheet.
- [ ] Primary action per state: no project → `프로젝트 지정` (chip picker popover, not a native
      select); project set & not sent → `프로젝트로 보내기`; sent → `에이전트에게 보냄 · 전달됨 14:02`
      (chip). `할 일로 전환` moves into the secondary menu; converted → chip `할 일로 전환됨 →`
      linking to the project.
- [ ] Group headers 오늘/어제/이번 주/이전 stay; pinned notes float in a `고정` group at the top.
- [ ] Acceptance: changing a filter updates the list without a full page reload flash; a memo body
      never shows a literal `@brainct` or `#연구아이디어`.

### 5.3 프로젝트 `/projects`
- [ ] Desktop (≥ lg): **row list** per group tab, sorted pinned → subgroup → sort. Row = color dot +
      name + subgroup eyebrow · status pill · activity sentence · active queue / next action · link
      icons (hover shows labels). No per-subgroup grid; subgroup appears as a small label so nothing
      is 2/3 empty.
- [ ] Mobile: single-column cards (current), but trim: summary (1 line), `다음: …`, activity sentence,
      links. Progress bar only when `progress.total ≥ 3` (else omit; the "0/1 (0%)" bar means nothing).
- [ ] Group tabs become a segmented control with counts `앱 6 · 연구 5 · 개인 3`; on mobile add the
      `프로젝트 | 논문 | 리뷰` control above it (§2).
- [ ] Acceptance: desktop list shows all 6 app projects in ≤ 320px of height; "644시간 전" never
      appears (relTime, §6).

### 5.4 프로젝트 상세 `/projects/[slug]`
- [ ] Header per §2 wireframe: name, status pill (inline select), group · subgroup · summary, one
      activity sentence, links row, `경로 복사` button (never print the path).
- [ ] `✎ 편집` opens the edit sheet containing the current `ProjectEditForm` fields **plus** paths,
      links (label/url/kind rows), color swatch, pinned. Saving shows a toast.
- [ ] `지금` block: nextAction inline-editable; active queue chips + `+ 큐`.
- [ ] 할 일 board unchanged on desktop; mobile → segmented list (§2). 나/에이전트 counts in the header.
- [ ] Sections 마감 / 논문 / 메모 only when non-empty (메모 keeps its capture box, pre-scoped).
- [ ] Acceptance: first viewport on desktop shows header + 지금 + the board's first row; no form
      fields visible until 편집 is pressed.

### 5.5 논문 `/papers` — 파이프라인
- [ ] Card content by stage: line 1 `shortName`; line 2 `track · journal` (or first target journal
      as "목표: JOA" when none); line 3 stage-specific: writing → `▸ nextAction`; submitted /
      under_review → `심사 n일째` from the latest `submissions[].submittedAt` (else `투고 n회`);
      revision → `⚠ 리비전 D-n` from the linked `Deadline` (paperId) else `리비전 기한 없음`;
      accepted/published → `journal · decidedAt(YYYY-MM)`. Title on hover (tooltip) and in the panel.
- [ ] Empty stages → footer chip row, droppable, expands only during drag (§2).
- [ ] Click a card → **detail panel** (desktop: 380px right rail; mobile: sheet): full title, stage
      select, track, journal, manuscript id (mono), target journals, submissions timeline
      (`PaperSubmissions`), linked deadlines, linked project, nextAction inline-edit, `+ 리비전 마감`
      shortcut that creates a Deadline (kind `paper`, `paperId`).
- [ ] Mobile: no kanban. List grouped by stage (collapsible headers with counts); stage change via
      the detail sheet's select. `←/→` keyboard move on desktop for a11y.
- [ ] `+ 논문` button (currently missing from the UI) → sheet with shortName, title, track, stage.
- [ ] Acceptance: at 1440 all non-empty columns are visible without horizontal scroll with up to 5
      non-empty stages; at 390 no horizontal scroll at all.

### 5.6 논문 — 리뷰 tab + 메일 후보
- [ ] Candidate card headline is a **sentence**: invitation → `<journal>에서 리뷰 초대 · 마감 10월 15일
      (D-19)`; reminder → `<journal> 리뷰 마감 알림 · D-3`; confirmation → `<journal> 리뷰 수락 확인됨`;
      revision → `<paper shortName> · Major revision 요청 · 제출 기한 11월 30일 (D-65)`; other →
      `리뷰 관련 메일 · 확인 필요`. Secondary line: subject (link when `account === 'main'`),
      `수신 3일 전 · main`. Due date is an inline date chip (click → date input), not a bare input.
- [ ] Actions: primary `추가` / `기존 리뷰 갱신` / `적용` (revision), secondary `무시` (undo toast).
      Revision without a matched paper: the paper picker appears inline with placeholder
      `어느 논문인가요?`; primary disabled until chosen.
- [ ] Review list rows: `journal · manuscriptId` · status pill · D-day chip · link icon; status change
      via pill menu (초대됨 → 수락/거절, 수락 → 제출완료). Quick-add stays as a one-row form.
- [ ] Acceptance: with 2 pending candidates the panel reads as two sentences, not a wrapped row of
      seven controls.

### 5.7 캘린더 `/calendar`
- [ ] Header: month nav · 오늘 · `월|주` · **per-calendar chips** (one per distinct `calendarName`,
      filled = visible; server-side `app_meta calendar:visible` per PLAN_3 Addendum A; holidays not a
      chip) · `+ 추가`. Google master toggle removed in favor of the chips.
- [ ] Cell rendering per §2: queue bars 6px with label, deadline/review chips solid with D-day,
      Google events outline `◦ HH:mm 제목`, memo dot, `+n`. Today: accent ring + accent date number;
      holidays: danger-colored date number; weekend headers `fg-2`.
- [ ] Mobile default = 주 view + agenda list for the visible week below (grouped by day, same chips).
- [ ] Bottom "마감 추가/관리" form and the "큐/할 일은 프로젝트 상세에서 편집" hint are **removed**.
      `+ 추가` and clicking a day open the existing day popover/sheet (memo / 할 일 / 마감 tabs).
      The deadline list moves into the right rail `다가오는 30일` (done ones hidden; `완료` via ⋯).
- [ ] Acceptance: queue bar contrast ≥ 3:1 against cell background in both themes; a month with no
      items still shows today + holidays clearly, no empty-list copy inside the grid.

### 5.8 설정 `/settings` (new)
- [ ] Sections: **연동 상태** (rows: 수집기 `마지막 수신 12분 전 · 6개 프로젝트`, Telegram
      `웹훅 설정됨 · 마지막 다이제스트 오늘 08:00`, Google `main: 3분 전 · 캘린더 3개 · 후보 0` and
      `amc: …`, Obsidian `마지막 가져오기 어제 · 2건`; each with an ok/warn dot by staleness),
      **캘린더 표시** (the visible-calendar chips, same state as the calendar header), **데이터**
      (`JSON 내보내기` → `/api/export`), **표시** (theme), **계정** (logout), **정보** (commit sha,
      deploy time, adapter local/supabase).
- [ ] `DATA:` the integration rows need last-seen timestamps. Cheapest: write
      `meta['integration:<name>'] = { at, summary }` from `/api/ingest`, `/api/google/sync`,
      `/api/capture` (source obsidian), and the Telegram webhook/digest. Flag for the planner.
- [ ] Acceptance: page renders in local mode with "설정되지 않음" rows instead of errors.

### 5.9 로그인 `/login`
- [ ] Centered 360px card: app mark, "Command Center", password field (16px, `autocomplete=
      current-password`, show/hide toggle), button `들어가기`, inline error in `--danger`, hint
      `이 기기에서 90일간 로그인이 유지돼요`. Rate-limit error copy: `잠시 후 다시 시도해 주세요 (10분)`.
      Theme follows system here.

---

## 6. Copy & tone (Korean microcopy)

- **Register:** labels are noun phrases without periods (`오늘`, `다음 액션`, `프로젝트로 보내기`);
  full sentences use 해요체, short, no exclamation marks (`저장했어요`, `오늘은 비어 있어요`). Avoid
  합니다체 except in the login/error path where it reads more formal (`비밀번호가 올바르지 않습니다`
  is fine).
- **Relative time — one helper `relTime(iso, now)` in `lib/logic/dates.ts` (unit-tested):**
  `방금` (< 1 min) · `n분 전` · `n시간 전` (< 24h) · `어제` · `n일 전` (< 14d) · `n주 전` (< 8w) ·
  `n개월 전` (< 12m) · else `2025년 3월`. Future: `n분 후`, `내일`, `n일 후`. Never hours beyond a
  day ("644시간 전" → "27일 전").
- **Absolute dates:** `10월 15일 (목)`; with year only when not this year. Times `14:00` (24h).
  D-day chips: `D-3` · `오늘` · `D+2` (keep `ddayLabel`, but render 0 as `오늘` in chips).
- **Status sentences** (format in `lib/status/*.ts` at the source, not in the component):
  - trading daemon: `IB+VR (해외, 실전) 데몬이 8주째 안 돌았어요 · 마지막 7월 31일 · 예정 9월 28일`
  - git stale: `CareNote · 30일째 커밋 없음 · 미커밋 변경 있음`
  - offline probe: `계좌 대시보드가 꺼져 있어요 (PC)`
  - partial: `계좌 대시보드 일부 응답 없음`
  - ok summary: `그 외 4개 정상`
  Rule: `<subject> · <what> · <since/next>`; numbers first-class; no `key=value`, no ISO dates.
- **Progress:** never `0/1 (0%)`. Below 3 tasks say `할 일 1개`; otherwise `2/5 완료` with the bar.
  Backlog bar label `백로그 12/40` (not `BACKLOG`).
- **Counts in nav/badges:** plain numbers, no parentheses: `메모 3`, not `메모 (3)`.
- **Buttons:** verb-final: `추가`, `저장`, `보내기`, `무시`, `실행 취소`, `들어가기`. Destructive
  in danger color only for permanent deletes (there are almost none — archive is not destructive).
- **Empty states:** one sentence + one verb. Avoid "없습니다" walls; prefer `~이 없어요` or
  `비어 있어요`.
- **Machine words to retire from the UI:** `last_run`, `next_due`, `BACKLOG`, `Phase 1b`, `master`
  as bare text (show as `(master)` after 커밋 only), absolute Windows/WSL paths, `WSL — 수집기 대기`
  (→ `WSL · 아직 수집 전`).

---

## 7. What NOT to do (single-user scope traps)

- No multi-user, roles, sharing links, comments, or activity feeds. No onboarding tour.
- No rich-text editor for memos; plain text + `@`/`#` is the feature.
- No charts/analytics dashboards (burn-down, velocity). The one bar per project is already borderline.
- No notification center in the app; Telegram is the notification channel.
- No service worker/offline mode; the PWA shell is enough and a SW would complicate the cookie/auth
  story on iOS.
- No theming beyond light/dark/system; no user-configurable layouts or widget drag.
- No i18n; Korean only (English identifiers for project names are content, not UI).
- No Google Calendar *write* (event creation) — one-way stays one-way.
- No drag-and-drop on the phone (papers, tasks); use sheets and menus.
- Do not add `cmdk`, `framer-motion`, `radix`, or a component library for this; the primitives in
  slice 1 are ~600 lines total and keep the bundle small for the phone.
- Do not change the data model to fix presentation (the only `DATA:` items are integration
  timestamps in `meta` and, optionally, nothing else).

---

## 8. Implementation order — 4 shippable slices (one agent each)

**Slice 1 — Foundation (no visible feature change, everything gets calmer)**
`app/globals.css` tokens (§3) + Pretendard link in `app/layout.tsx`; primitives in `components/ui/`:
`Button`, `Chip`, `Card`, `Sheet`, `Popover`, `Toast` (+ provider in `app/(main)/layout.tsx`),
`Skeleton`, `EmptyState`, `SegmentedControl`; `relTime` + tests; status sentence formatting in
`lib/status/*`; nav: settings entry, ⌘K button placeholder, mobile FAB → capture sheet, remove
"Phase 1b"; dark-mode status style (left-border rule) applied to `status-panel.tsx`, `dday-chip.tsx`,
`project-card.tsx`. Acceptance: typecheck/tests/build pass; all 8 routes render in both themes with
the new tokens; mobile 390 has no horizontal overflow on any route.

**Slice 2 — Home + Memo (the "what now?" screen)**
§5.1 and §5.2 in full: 오늘 panel (collapse empty sections, inline Google events), 이번 주 strip,
상황 sentences + 최근 활동, memo strip and 논문 strip, remove 진행률 from home; memo page instant
filters, hover actions, `⋯` sheet, stripped tokens, primary-action-by-state, undo toasts for
archive/done; `loading.tsx` for `/` and `/memo`. Acceptance per §5.1/§5.2.

**Slice 3 — Projects + Papers + Reviews**
§5.3–5.6: project row list, detail header + edit sheet + 지금 block, mobile task list; paper cards by
stage, empty-stage footer chips, detail panel/sheet, mobile stage list, `+ 논문`; candidate sentence
cards, undo on 무시; `loading.tsx` for these routes; keyboard `←/→` on cards. Acceptance per sections.

**Slice 4 — Calendar + Settings + Palette**
§5.7–5.9 plus §4.1/§4.2: calendar contrast + per-calendar chips + agenda on mobile + remove bottom
form; `/settings` with integration rows (`DATA:` meta timestamps — coordinate with the planner, can
ship with "알 수 없음" rows first); ⌘K palette with static index; shortcuts; `visibilitychange`
refresh; login polish. Acceptance per sections; `?` shows the shortcut sheet.

Each slice ends with the same gate: `npm run typecheck && npm test && npm run build`, then
screenshots of the 8 routes × 2 themes × 2 widths into the scratchpad for the planner to diff
against `shots-before/`.
