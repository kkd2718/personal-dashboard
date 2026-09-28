# PLAN — paper pipeline shows each paper's project checklist; checklist replaces "다음 액션"

Owner ask (2026-09-28):
- Clicking a paper in the 논문 파이프라인 should show its stage-by-stage status and checklist.
  Today, clicking CXR2BodyComposition shows no checklist.
- A single "다음 액션" doesn't fit papers or projects where several checklist items run in
  parallel, or where the order changes after co-author discussion.

Data already exists. A paper's `projectId` → meta `project:detail:<projectId>` holds a
`ProjectDetail`, whose `status` is a `CcStatus` with a checklist (`lib/logic/project-detail.ts`,
`components/projects/project-status-card.tsx`). This plan changes the UI only. **Do not change
the data model, and do not remove `nextAction` fields.** They stay as the fallback for projects
without a checklist.

## 1. Pure logic — `lib/logic/project-detail.ts` (+ tests)

Add `checklistSummary(status: CcStatus | null, today: string)`, which returns
`{ doing: string[]; meOpen: number; open: number; total: number; blocked: number; nextDue: { text: string; due: string } | null } | null`.

- Return null when `status` is null or has no checklist.
- `doing`: texts of items with status `doing`, in order.
- `meOpen`: open items with owner `me`. Open means status is not `done`, and `blocked` counts as open.
- `nextDue`: the open item with the earliest `due` on or after `today`. Also consider overdue
  items and pick the earliest overall; overdue first is fine.

Add `checklistLine(summary): string`, a compact one-liner:
- when `doing` is non-empty: `진행 중: <doing[0]>` plus ` 외 N` if there are more;
- otherwise, when `nextDue` exists: `다음 마감 M/D <text>`;
- otherwise: `남은 <open>/<total>`;
- then append ` · 내 할 일 <meOpen>` when meOpen > 0.

Unit-test both.

## 2. Papers page — fetch details

`app/(main)/papers/page.tsx`: for the distinct `projectId`s of the papers, load
`repo.getMeta<ProjectDetail>(projectDetailMetaKey(id))` in parallel. Pass
`details: Record<string, ProjectDetail>` (only the non-null ones) to `PaperBoard` and on to
`PaperDetail`.

Support a `?paper=<id>` search param that opens that paper's detail sheet on load.
- `PaperBoard` gets an `initialSelectedId?: string` prop.
- The home paper lane rows link to `/papers?paper=<id>` instead of `/papers`.

## 3. `components/papers/paper-detail.tsx`

- New section **"현황"**, placed right after the title/stage/track/project-link block and above
  저널.
  - When `details[paper.projectId]` exists, render `<ProjectStatusCard detail={...} now={...} />`.
    It is a plain component with no server-only imports, so it can render inside this client
    component. Check that and adjust if not. Drop its own `<h2>현황</h2>` heading if it
    duplicates, e.g. with a `hideTitle` prop.
  - When there is no detail but there is a project, show one muted line: "이 논문 프로젝트의
    Claude 세션이 docs/cc-status.json 을 쓰면 체크리스트가 여기 표시돼요".
- The **다음 액션** field shows only when there is NO checklist. When a checklist exists, hide
  it. The checklist replaces it.

## 4. Where `nextAction` is displayed → prefer the checklist line

Wherever a project's or paper's `nextAction` is shown, show `checklistLine(...)` when that
project has a checklist, and fall back to `nextAction` otherwise.
- `lib/logic/papers.ts` `paperCardLine(...)`: add an optional last parameter
  `checklist?: string | null`. The writing-stage line becomes `▸ <checklist> · 목표 X` when
  given, else the current `▸ nextAction` behaviour. Update tests.
- Home paper lane (`components/home/paper-lane.tsx`) and the paper board cards: pass the
  summary line.
  - Home `app/(main)/page.tsx` must load details for the papers' projects, the same way as §2.
  - To keep it cheap, one `Promise.all` of `getMeta` calls for the distinct project ids is fine.
- `components/project-card.tsx` ("다음: …"), `components/projects/project-row.tsx`
  (`secondary`), `components/home/queue-lane.tsx` (`nextAction` card) plus
  `lib/logic/home.ts` `buildQueueLaneCards`: when the project has a checklist, show
  `checklistLine` instead of `다음: nextAction`.
  - In `buildQueueLaneCards`, add a new card kind `'checklist'` with `{ project, line }`, used in
    place of `'nextAction'` when a summary exists.
  - This needs details passed in: add an optional `details` param defaulting to `{}` so existing
    callers and tests still work.
  - Projects pages must load details for the projects they list: the projects list page, and
    wherever project-card/project-row render.
- `app/(main)/projects/[slug]/page.tsx`: the "지금" section's `NextActionEditor` shows only when
  the project has no checklist. The 현황 card already shows the checklist.

## 5. Constraints

- Korean UI copy as above. Mobile-safe: `min-w-0`, `truncate`/`break-words`.
- Keep the Repo adapter rule: pages fetch through `getRepo()`, and client components receive
  props.
- `npm run typecheck`, `npm test`, `npm run build` must pass. Check exit codes.
- No commits. The main session reviews and deploys.
