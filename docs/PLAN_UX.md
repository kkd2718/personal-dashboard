# UX overhaul — execution plan (2026-09-26)

Source spec: `docs/reviews/ux-advice.md` (Fable). This file records the planner's decisions; where it
differs from the spec, **this file wins**. Baseline: 2c4a78a (phase 3 shipped). Owner goal: product
level — "someone would pay for it". Private single-user app; Korean UI.

## Planner decisions / overrides
1. **Home keeps a progress view** (the owner explicitly asked for per-project/queue %). Replace the old
   진행률 panel AND the spec's "최근 활동" with ONE merged section **"프로젝트"** under 상황:
   each active project (max 6, sorted by most recent session/commit): color dot · name · one sentence
   (`방금 세션 · 커밋 3일 전`) · a thin bar with the spec's progress copy (`할 일 1개` below 3 tasks,
   `2/5 완료`, `백로그 8/12` when backlog metrics exist — show backlog when the project has no open
   tasks or its group is app). Row click → project detail. "전체 →" link.
2. **Mobile tab bar**: 홈 · 메모 · (+) · 프로젝트 · 캘린더 as in the spec; 논문 via the
   `프로젝트 | 논문 | 리뷰` segmented control on mobile. Accepted.
3. **Settings DATA item approved**: write `app_meta['integration:<name>']` = `{ at: ISO, detail?: string }`
   on: `/api/ingest` (name `collector`), `/api/google/sync` (`google:<account>`), `/api/capture` when
   source is obsidian (`obsidian`), Telegram webhook + digest sends (`telegram`). Slice 4 reads them.
4. **No new dependencies** (no cmdk/radix/framer-motion/component libs), per spec §7.
5. Fonts: Pretendard dynamic-subset CSS from jsDelivr is fine (external CSS/fonts are allowed).
6. Known bug to fix in slice 3: Amgi's project card shows `WSL — 수집기 대기` and no backlog bar even
   though the collector ingests backlog metrics for it — find the activity/matching mismatch.

## Slices (one Sonnet agent each; slices 2 and 3 may run in parallel after slice 1 lands)
- **Slice 1 — Foundation**: spec §8 slice 1 verbatim, plus: fix mobile horizontal overflow on every
  route (acceptance: `scrollWidth === innerWidth` at 390px), relTime everywhere times are shown,
  status sentences at the source (`lib/status/*` and `scripts/lib/status-items.mjs` — the collector builds
  the cloud items, so both), `DATA:` integration timestamps from decision 3 (writes only).
- **Slice 2 — Home + Memo**: spec §5.1, §5.2, with decision 1 replacing "remove 진행률".
- **Slice 3 — Projects + Papers + Reviews**: spec §5.3–5.6 + decision 6.
- **Slice 4 — Calendar + Settings + ⌘K**: spec §5.7–5.9, §4.1, §4.2.

## Gate for every slice
`npm run typecheck && npm run lint && npm test && npm run build` + `node scripts/check-isolation.mjs`.
Visual check: run the dev server on :3100 in local mode (LocalRepo — use a temporary
`.env.development.local` that blanks `NEXT_PUBLIC_SUPABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`;
delete it afterwards; never edit `.env.local`), then capture 8 routes × light/dark × 1440/390 with
`<scratchpad>/audit-shots.mjs` (args: `.env.local <scratchpad> http://localhost:3100 <slice-tag>`; it
skips login when no /login redirect). Look at every screenshot yourself before reporting; fix what
looks wrong. Kill the dev server tree afterwards. Don't commit/push (push = production deploy); the
planner reviews, commits, and pushes.
