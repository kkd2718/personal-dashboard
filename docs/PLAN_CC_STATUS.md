# PLAN — project detail: open backlog items + Claude-written status log

Owner ask (2026-09-27): "amgi 남은 코드 항목 네 개가 뭔지 클릭 상세로 들어가도 안 나온다. 관리되는
프로젝트들이 커맨드센터 대시보드용 로깅을 남기도록 harness 훅 같은 걸 만들어 달라."

Two data sources, one new per-project detail blob, shown on `/projects/[slug]`.

- **A. Open item titles** from labeled markdown bars (`라벨=path#section`), e.g. Amgi `코드`.
  Automatic — the collector already reads these files.
- **B. `docs/cc-status.json`**, written by each project's own Claude session. The protocol reaches
  every managed project through the existing global SessionStart hook (`scripts/cc-inbox.mjs`), so
  no per-repo CLAUDE.md edits are needed. A new Stop hook nudges once per session when the session
  committed but didn't refresh the file.

Nothing here may send secrets, patient data, account numbers or holdings — the protocol text says
so explicitly, and the ingest caps sizes.

## 1. `scripts/lib/backlog.mjs` — `listOpenItems(text, max = 15)`

- Returns `string[]`: titles of the **open** items, using exactly the same classification as
  `countBacklog`. If checkbox lines exist, use `- [ ]` lines; otherwise use top-level numbered
  items that are not done by `countBacklog`'s rule.
- Title = the first `**bold**` segment's inner text if the line has one. Otherwise, the line with
  the numbering or checkbox prefix removed and `**`, `~~` and backticks stripped.
- Trim a trailing `:` or `—`. Truncate to 80 chars, adding `…` when cut.
- Cap at `max` items.
- Tests in `scripts/lib/backlog.test.mjs`:
  - an Amgi-style numbered list (bold lead, `~~strike~~ **완료**`, ✅);
  - a checkbox list;
  - truncation;
  - the max cap;
  - the `extractSection` combination.

## 2. `scripts/lib/cc-status.mjs` — `parseCcStatus(text)` (new, plain JS, Node 18)

File schema (what project sessions write):
```json
{
  "updatedAt": "2026-09-27T16:00:00+09:00",
  "focus": "지금 하고 있는 일 한 줄",
  "next": ["다음 할 일", "..."],
  "blockers": ["막힌 것 (없으면 빈 배열)"],
  "done": [{ "date": "2026-09-27", "text": "끝낸 일 한 줄" }]
}
```

Parsing and normalization:
- Returns the normalized object or `null` for bad JSON or a non-object.
- Every field is optional. Non-strings are dropped, and strings are trimmed.
- `focus`: max 200 chars.
- `next` and `blockers`: max 8 items × 200 chars.
- `done`: max 10 items, newest first as given. `date` must match `YYYY-MM-DD`, else null; `text` is max 200 chars.
- `updatedAt`: kept only if `Date.parse` is finite.
- Returns `null` when every field ends up empty.

Tests in `scripts/lib/cc-status.test.mjs`.

## 3. Collector (`scripts/collector.mjs`)

- In `collectBacklogMetrics`, for **labeled, non-.json** entries also compute
  `listOpenItems(section ? extractSection(raw, section) : raw)`.
- Return the items alongside the metrics, e.g. change the return to `{ metrics, openItems }` where
  `openItems = { [label]: string[] }`. Keep the metric keys identical.
- In `collectProjectActivity`, read `docs/cc-status.json` using the existing `readBacklogGlob`
  (which already handles WSL paths) and run it through `parseCcStatus`.
- Build `projectDetails: [{ projectId, collectedAt, openItems, status }]`. Include only projects
  where `openItems` is non-empty or `status` is non-null.
- Send it in the ingest payload as optional `projectDetails`.
- The existing `projectActivity` shape must not change.

## 4. Types + pure logic

- `lib/types.ts`:
  ```ts
  export interface CcStatus {
    updatedAt: string | null;
    focus: string | null;
    next: string[];
    blockers: string[];
    done: Array<{ date: string | null; text: string }>;
  }
  export interface ProjectDetail {
    projectId: string;
    collectedAt: string;
    openItems: Record<string, string[]>;
    status: CcStatus | null;
  }
  ```
- `lib/logic/project-detail.ts`:
  - `projectDetailMetaKey(projectId) => \`project:detail:${projectId}\``
  - `statusAgeLabel(status, now): string | null` — "3시간 전 기록" via `relTime`, or null when
    `updatedAt` is missing.
  - `isStatusStale(status, nowMs, days = 7): boolean`
- `lib/logic/project-detail.test.ts`.

## 5. Ingest (`app/api/ingest/route.ts`)

- Add an optional zod `projectDetails` array, max 50 entries. Enforce the same caps as §1/§2:
  - item strings max 200;
  - `openItems` max 10 labels × 15 items;
  - `next` and `blockers` max 8;
  - `done` max 10.
- For each entry, call `repo.setMeta(projectDetailMetaKey(id), entry)`.
- Do **not** delete meta for projects absent from the payload. A collector run that failed to read
  a file must not wipe the last good detail.

## 6. UI — `app/(main)/projects/[slug]/page.tsx`

- Fetch `repo.getMeta<ProjectDetail>(projectDetailMetaKey(project.id))` in the existing
  `Promise.all`.
- New component `components/projects/project-status-card.tsx` (server component), placed right
  after the header/progress area, titled **"현황"**:
  - With `status`: show the focus line (bold), 다음 (list), 막힘 (list, amber, only if non-empty),
    최근 완료 (up to 5, `M/D text`), and a muted `statusAgeLabel`. Add a "오래됨" amber marker when
    `isStatusStale`.
  - Without `status`: one muted line: "이 프로젝트의 Claude 세션이 docs/cc-status.json 을 쓰면
    여기에 표시돼요".
  - For each label in `openItems`: a `<details>` with `<summary>남은 {label} {n}개</summary>` and
    the item list. Show it only when n > 0.
- Mobile-safe: no fixed widths, `min-w-0` + `break-words` on items.

## 7. Hooks — `scripts/cc-inbox.mjs` (must stay Node 18 compatible, no deps)

### 7a. SessionStart (`hook`, existing)

- Read `session_id` from the stdin payload as well as `cwd`.
- When `data.project` is non-null (a managed project), **always** print the protocol block, even
  with zero tasks or memos, and print the inbox block as before when items exist.
- Protocol block text (Korean, short):
  ```
  ## Command Center 기록 규칙
  이 프로젝트는 개인 커맨드센터 대시보드에 표시돼요. 의미 있는 작업 단위를 끝낼 때마다(그리고 세션을 마치기 전에)
  <projectRoot>/docs/cc-status.json 을 갱신하세요: {updatedAt, focus, next[], blockers[], done[{date,text}]}
  - done 은 최신순 최대 10개, 각 항목 한 줄. next/blockers 는 최대 8개.
  - 비밀값·토큰·환자/개인 정보·계좌번호·보유 종목은 절대 쓰지 마세요. 요약만.
  - 기존 파일이 있으면 읽고 병합(덮어쓰기 전에 done 이력 유지). 커밋해도 됩니다.
  현재 상태: <없음 | N일 전 갱신 | 최근 갱신>
  ```
  `projectRoot` = the git top-level of cwd (`git rev-parse --show-toplevel`, 2s timeout), falling
  back to cwd. The current state comes from the file's `updatedAt` or mtime.
- When `session_id` exists, write the marker
  `os.tmpdir()/cc-session-<session_id>.json = { startedAt: ISO, root, projectId, reminded: false }`.
- Never throw, and keep the existing 3s network timeout.

### 7b. Stop (`stop`, new)

- Read the stdin JSON `{ session_id, cwd, stop_hook_active }`. Exit 0 silently when:
  - `stop_hook_active` is true;
  - there is no marker;
  - the marker has `reminded: true`.
- Run `git -C <root> log --since=<startedAt> --format=%H -1` (2s timeout). If there are no
  commits since the session started, exit 0.
- If `docs/cc-status.json` is missing or its mtime is earlier than `startedAt`:
  - set `reminded: true` in the marker;
  - print `{"decision":"block","reason":"Command Center: 이번 세션에 커밋이 있었는데 docs/cc-status.json 이 갱신되지 않았어요. 기록 규칙대로 갱신한 뒤 마치세요."}` to stdout;
  - exit 0.
- Any error → exit 0 silently. The hook must never wedge a session.
- Unit-testable pieces: put `protocolBlock(root, stateText)`, `statusStateText(updatedAtOrMtimeMs,
  nowMs)` and `shouldRemind({ marker, hasCommits, statusMtimeMs })` in
  `scripts/lib/cc-hook.mjs`, pure, with `scripts/lib/cc-hook.test.mjs`.
- Usage line: `hook|stop|list [path]|done <id>`.

Hook registration in `~/.claude/settings.json` (Windows and WSL) is done by the main session after
review, not by the implementer.

## 8. Docs

Add a short CLAUDE.md "Post-3 polish" addendum covering:
- `docs/cc-status.json` protocol;
- `project:detail:<id>` meta;
- the Stop hook.

## 9. Amendment (2026-09-27) — per-project checklist on the dashboard

Owner wants the actual project checklist visible, not just a running log.

`docs/cc-status.json` gets a new `checklist` field:
```json
{
  "checklist": [
    { "text": "항목 설명", "status": "todo", "section": "코드", "owner": "me" }
  ]
}
```
- `status`: `'todo' | 'doing' | 'done'` — anything else drops the item.
- `section`: optional, max 40 chars, used to group the UI.
- `owner`: `'me' | 'agent'` — anything else/missing defaults to `'agent'` (`'me'` = the user must
  personally judge/experiment/contact someone/manually confirm; `'agent'` = Claude can do it).
- Cap 60 items, `text` max 200 chars.

`scripts/lib/cc-status.mjs`'s `parseCcStatus` parses/normalizes it the same way as the other
fields (drop invalid, trim, cap). `lib/types.ts`'s `CcStatus` gets `checklist: CcChecklistItem[]`
(`{ text, status, section, owner }`). The ingest zod schema gets matching caps.

**Collector**: when `status.checklist` is non-empty, also emit `bar:체크리스트:done` /
`bar:체크리스트:open` (open = todo+doing) into `ProjectActivity.metrics` — unless the project's
own `backlogGlobs` already produced a labeled bar called `체크리스트` (never overwrite a project's
own choice of that label).

**UI**: the "현황" card's checklist renders as `components/projects/cc-checklist.tsx`, a small
client component (needed for the view-switcher's local state) with three views — 전체 / 내 할 일 /
에이전트 — each showing `(open/total)` counts. Within a view: grouped by `section`, `doing` items
before `todo`, `done` items collapsed under `<details>완료 N개</details>`. In the 전체 view, items
with `owner: 'me'` get a small "나" badge.

**Protocol block** (`scripts/lib/cc-hook.mjs`'s `protocolBlock`) gains two lines: what `checklist`
is for and that finishing an item means flipping it to `done` immediately, and the `owner` rule
above.

Everything else in this plan is unchanged.

## Verification

- `npm run typecheck`, `npm test` (all green), `npm run build`.
- `node scripts/cc-inbox.mjs list <amgi wsl path>` prints the protocol block.
- A dry run of the collector's detail extraction on the Amgi backlog should list the 4 open code
  items. A small ad-hoc script is fine; do not POST to ingest from tests.
