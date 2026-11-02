# PLAN_PERF_PUSH — cc-status push, collector log/retry, stale-tab reload, home perf

Planner: Opus. Implementer: Sonnet builds strictly from this file; flag mismatches, don't redesign.
Constraints: no added cost, never log secrets, no personal identifiers outside docs/ (`scripts/check-isolation.mjs`),
dates via `lib/logic/dates.ts`, Repo adapter rule, pure logic in `lib/logic` / `scripts/lib` with tests.
`scripts/cc-inbox.mjs` and everything it imports must stay **Node 18, plain ESM, no deps** (WSL).

## 0. Facts verified (2026-11-02)

| Fact | Evidence |
|---|---|
| Hooks wired on Windows (`node "<repo>/scripts/cc-inbox.mjs" hook/stop/prompt`) **and** WSL (`node /mnt/c/<repo>/scripts/cc-inbox.mjs ...`, timeouts 5/5/3 s) | `~/.claude/settings.json` on both sides |
| WSL node is v18.19.1 (has global `fetch`, `AbortSignal.timeout`, `node:crypto`) | `wsl.exe -e node --version` |
| WSL hook reads `.env.local` through `/mnt/c` (path from `import.meta.url`) and posts the Linux cwd; `matchProjectByPath` already maps `/home/...` and `/mnt/c/...` | `scripts/cc-inbox.mjs:47-49`, `lib/logic/path-match.ts:11-17` |
| `/api/agent-inbox*` is already public in `proxy.ts` (bearer checked in route) → a new `/api/agent-inbox/status` needs no proxy change | `proxy.ts:22` |
| Stop hook returns on `stop_hook_active` **before anything else** | `scripts/cc-inbox.mjs:334` |
| Collector parses with `parseCcStatus` (`scripts/lib/cc-status.mjs`); ingest re-validates with a zod `ccStatusSchema` that is private to the route | `scripts/collector.mjs:316-320`, `app/api/ingest/route.ts:40-55` |
| Collector `process.exit(1)` at env check, config fetch, ingest — no log, conhost masks exit code | `scripts/collector.mjs:43,409,456` |
| Prod has **no** `deploymentId` / skew protection (`<html lang="ko">`, no `data-dpl-id`, no `?dpl=`); Next is 16.3.6 | prod HTML, `node_modules/next/package.json` |
| Next already hard-reloads on **navigation** when the RSC build id differs | `node_modules/next/dist/client/components/router-reducer/fetch-server-response.js:175` |
| Stale **server action** → server answers "action not found" → client throws `UnrecognizedActionError` (check with `unstable_isUnrecognizedActionError` from `next/navigation`) | `.../reducers/server-action-reducer.js:101-108`, `next/dist/client/components/navigation.d.ts:126` |
| A server action that calls `revalidatePath`/`refresh` re-renders **only the current route** in its response; actions are dispatched **one at a time** | `node_modules/next/dist/docs/01-app/02-guides/server-actions.md:72,150`; `01-getting-started/07-mutating-data.md:207` |
| Prod `/` (icn1, warm): HTML ttfb 490 ms / total 1056 ms / 225,721 B; RSC (`RSC: 1`) ttfb 157 / total 1114 ms / **157,403 B**. `/calendar` 469 ms, `/projects` 492 ms | measured with a minted session cookie |
| Baseline: `/login` 150–350 ms; `/api/agent-inbox` (4 parallel selects) 240–270 ms warm → one parallel DB stage ≈ 50–100 ms | measured |
| Home RSC composition: StatusWarnChip `tasks` **43,156 B**, `projects` 9,552, `activityList` 5,571; WeekStrip `notes` **22,506 B**, deadlines 5,793, googleEvents 4,417, workShifts 4,004; layout BottomNav `projects` 8,192 | RSC row parse |
| DB: tasks 63 rows (49 done, descriptions 20.7 KB total, open 2.6 KB); notes 41 (27 done, 12 sent, 2 inbox; **0** dated non-done); project:detail 13 keys / 145 KB | Supabase REST |
| Slimmed sizes: checklist-relevant tasks (open + done today) 14 rows 7.6 KB; `{projectId,status}` for all tasks ≈ 3–4 KB; calendar-relevant notes 0 B | computed |
| Home data waterfall: stage 1 (16 reads) → stage 2 (`getMeta` × ~15 details) → stage 3 `getStatusPanelData` ‖ `loadProjectDue` which itself does `listProjects` → `getMeta` × ~19 + resolved = **4 sequential DB round trips, ~53 queries** (+4 in layout) | `app/(main)/page.tsx:52-101`, `lib/telegram/digest.ts:54-70` |

Ambiguities resolved: push key = git toplevel `root` (where the file lives, same as collector's `<projectPath>/docs/cc-status.json`); no "older updatedAt" guard (last write wins, same as collector); push also refreshes the 체크리스트 bar in `project_activity.metrics` (else the bar lags until the collector).

---

## A1. cc-status push from the hooks

### A1.1 Shared schema — new `lib/logic/cc-status-schema.ts`
Move `ccChecklistItemSchema` and `ccStatusSchema` verbatim out of `app/api/ingest/route.ts:40-55`; export both.
Ingest imports them (no behavior change). Separate file (not project-detail.ts) so zod never reaches a client bundle.

### A1.2 Pure helpers — `lib/logic/project-detail.ts`
```ts
export const PROJECT_DETAIL_META_PREFIX = 'project:detail:';      // projectDetailMetaKey uses it
export function mergePushedStatus(existing: ProjectDetail | null, projectId: string, status: CcStatus, nowIso: string): ProjectDetail
// = { projectId, collectedAt: existing?.collectedAt ?? nowIso, openItems: existing?.openItems ?? {}, status }
export function checklistBarMetrics(status: CcStatus | null, backlogGlobs: readonly string[] | null | undefined): Record<string, number> | null
// null when status?.checklist is empty/absent, or any glob's label === '체크리스트'
// (label rule = scripts/lib/backlog.mjs parseBacklogEntry: text before the first '=' when that text has no '/').
// else { 'bar:체크리스트:done': d, 'bar:체크리스트:open': total - d }
```

### A1.3 Route — new `app/api/agent-inbox/status/route.ts`
`export const dynamic = 'force-dynamic'`. `POST` only.
1. `checkBearer(request, process.env.AGENT_TOKEN)`: missing-config → 503, unauthorized → 401 (same JSON shape as agent-inbox).
2. `raw = await request.text()`; `Buffer.byteLength(raw) > 128 * 1024` → 413. Bad JSON → 400.
3. zod `{ path: z.string().min(1).max(500), status: ccStatusSchema }` → 400 with `error.message`.
4. `projects = await repo.listProjects()`; `project = matchProjectByPath(projects, path)`; none → `200 { ok: true, project: null }` (no write).
5. `[existing, activityList] = await Promise.all([repo.getMeta<ProjectDetail>(key), repo.listProjectActivity()])`.
6. `await repo.setMeta(key, mergePushedStatus(existing, project.id, status, nowIso))`.
7. `bar = checklistBarMetrics(status, project.backlogGlobs)`; `activity = activityList.find(a => a.projectId === project.id)`;
   if both → `repo.upsertProjectActivity({ ...activity, metrics: { ...activity.metrics, ...bar } })` (never create a row).
8. `200 { ok: true, projectId: project.id, bar: boolean }`. No revalidatePath (all readers are force-dynamic). Never log the body.

### A1.4 Hook pure helpers — `scripts/lib/cc-hook.mjs` (add `import { createHash } from 'node:crypto'`)
```js
export function statusContentHash(parsedStatus)   // sha256 hex of JSON.stringify(parsedStatus)
export function statusPushKey(root)               // sha256 hex of root.trim().replace(/\\/g,'/').toLowerCase().replace(/\/+$/,'') → first 16 chars
export function shouldPushStatus({ markerProjectId, hash, pushedHash })
// false if markerProjectId === null (unmanaged dir) || !hash || hash === pushedHash; else true
// (markerProjectId undefined = no marker → allowed)
```

### A1.5 Hook wiring — `scripts/cc-inbox.mjs`
Constants: `PUSH_FETCH_MS = 5000`, `PUSH_LOCK_MS = 30000`.
Paths (os.tmpdir(), so Windows and WSL keep separate state — fine):
`pushRecordPath(root) = cc-status-pushed-<statusPushKey(root)>.json` (`{hash, at}`), `pushLockPath(root) = cc-status-push-<key>.lock`.

```js
async function maybeSpawnStatusPush({ markerProjectId, root, cwd })  // never throws, never prints, no network
```
- `if (markerProjectId === null) return`; `root = root || await gitTopLevel(cwd || process.cwd())`.
- read `ccStatusPath(root)` (missing → return); `status = parseCcStatus(text)` (null → return); `hash = statusContentHash(status)`.
- `rec = JSON.parse(readFile(pushRecordPath(root)))` or null; `if (!shouldPushStatus({markerProjectId, hash, pushedHash: rec?.hash})) return`.
- lock exists and younger than PUSH_LOCK_MS → return; write lock; `spawn(process.execPath, [SCRIPT_PATH, 'push-status', root], { detached: true, stdio: 'ignore', windowsHide: true }).unref()` (same pattern as `spawnRefresh`, `cc-inbox.mjs:286-301`).

```js
async function runPushStatus(root)   // subcommand `push-status <root>`; detached child or manual
```
- env `CLOUD_URL`/`AGENT_TOKEN` missing → return. Re-read + parse file (null → return); hash.
- `POST ${CLOUD_URL}/api/agent-inbox/status` body `{ path: root, status }`, bearer header, `signal: AbortSignal.timeout(PUSH_FETCH_MS)`.
- `res.ok` → write `pushRecordPath(root)` `{ hash, at: new Date().toISOString() }` (also when `project: null`, so unmanaged roots aren't re-posted every turn).
- `console.log(\`push-status: ${res.status}\`)` / `push-status: error` (stdout is ignored when detached; useful manually). Never print token/body.
- `finally { unlink(lock).catch(); process.exit(0) }`.

Call sites:
- **runStop**: after parsing stdin and `marker = sessionId ? await readMarker(sessionId) : null`, call
  `await maybeSpawnStatusPush({ markerProjectId: marker ? marker.projectId : undefined, root: marker?.root, cwd })`
  **before** `if (stopHookActive) return` — the turn right after the nudge is exactly the one that refreshes the file.
  Rest of runStop unchanged (reuse the already-read marker).
- **runHookOrList** (hook mode only, managed project, after `writeMarker`): `await maybeSpawnStatusPush({ markerProjectId: data.project.id, root, cwd })` — catches edits from sessions that ended without a Stop.
- Dispatcher: add `else if (cmd === 'push-status') await runPushStatus(arg)`; usage string updated.
- `prompt` mode unchanged (keeps its no-network, <150 ms budget).

WSL: works with no settings change (facts table). The only per-environment difference is the tmpdir record, which just means each side pushes its own changes.

## A2. Collector run log + network retry

### A2.1 `scripts/lib/net-retry.mjs` (new, pure, Node 18)
```js
export const RETRY_STATUSES = [502, 503, 504];
export function isRetryableNetworkError(err)
// true when err.name is 'AbortError' | 'TimeoutError', or (err instanceof TypeError && /fetch failed/i.test(err.message)),
// or err.cause?.code ∈ {ECONNREFUSED, ECONNRESET, ENOTFOUND, EAI_AGAIN, ETIMEDOUT, ENETUNREACH, EHOSTUNREACH, UND_ERR_CONNECT_TIMEOUT, UND_ERR_SOCKET}
export async function fetchWithRetry(doFetch, { delays = [5000, 15000], sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {})
// returns { res, attempts }. Attempt i+1 after sleep(delays[i]) when doFetch threw a retryable error
// or resolved with RETRY_STATUSES. Non-retryable throw → rethrow immediately. After the last attempt:
// retryable throw → rethrow; retryable status → return that res.
```

### A2.2 `scripts/lib/run-log.mjs` (new)
```js
export function formatRunLogLine({ at, ok, stage, reason, counts, ms, attempts })
// `${at} ${ok ? 'ok' : 'fail'}` + (stage ? ` stage=${stage}` : '') + counts as ` k=v` in insertion order
// + ` attempts=${attempts}` + ` ms=${ms}` + (reason ? ` reason="${clean}"` : ''); clean = reason with \r\n→' ', '"'→"'", max 200 chars.
export async function appendRunLog(file, line, maxBytes = 256 * 1024)
// mkdir -p dirname; if stat(file).size > maxBytes → rename(file, file + '.1') (overwrites old .1); appendFile(line + '\n'). Never throws.
```

### A2.3 `scripts/collector.mjs`
- `LOG_FILE = path.join(ROOT, '.data', 'collector.log')` (`.data/` is gitignored, `.gitignore:45`).
- Replace the three `process.exit(1)` with a `class StageError extends Error { constructor(stage, reason) }` thrown from `main()`; env check also throws `StageError('env', 'CLOUD_URL / INGEST_TOKEN not set')` (move it inside a function so the log runs).
- Config fetch: `fetchWithRetry(() => fetch(configUrl, { headers, signal: AbortSignal.timeout(15000) }))`; not ok → `StageError('config', \`${res.status}\`)`; thrown → `StageError('config', e.message)`.
- Ingest: same with `AbortSignal.timeout(30000)`; not ok → `StageError('ingest', \`${res.status} ${(await res.text()).slice(0, 150)}\`)`. Ingest retry is safe: every write is an upsert/setMeta and alerts are cooldown-deduped.
- `main()` returns `{ projects: projects.length, collected: validActivity.length, details: projectDetails.length, statusItems: statusItems.length, obsidian: obsidian.imported, attempts }`.
- Top level: `const t0 = Date.now(); try { const s = await main(); await appendRunLog(LOG_FILE, formatRunLogLine({ at, ok: true, counts: {...}, attempts, ms })) } catch (e) { await appendRunLog(..., { ok: false, stage: e.stage ?? 'unknown', reason: e.message }); console.error(...); process.exitCode = 1 }`.
- Reasons are `e.message` / HTTP status / ≤150 chars of the server's error JSON — never headers, never the payload.
- Example lines: `2026-11-02T01:09:12.345Z ok projects=19 collected=19 details=13 statusItems=5 obsidian=0 attempts=1 ms=8123`
  / `2026-11-01T09:47:03.002Z fail stage=config attempts=3 ms=20412 reason="fetch failed"`.

---

## B. Stale tab after deploy

Native coverage: navigation already hard-reloads on build-id mismatch (facts). **Do not set `deploymentId`**: without host routing by deployment it only adds `?dpl=` and the same reload we already get (docs `deploymentId.md` "Multi-server" note). Gaps to close: idle tab/PWA resumed without navigating, and server actions from a stale bundle.

### B1. Version constant — `next.config.ts`
```ts
const appVersion = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || 'dev';
const nextConfig: NextConfig = { env: { CC_APP_VERSION: appVersion } };
```
`env` is inlined at build into both server and client bundles, so the client's baked value and the route's value come from the same build.

### B2. Route — new `app/api/version/route.ts`
`dynamic = 'force-dynamic'`; `GET` → `NextResponse.json({ version: process.env.CC_APP_VERSION ?? 'dev' }, { headers: { 'cache-control': 'no-store' } })`. No repo access. Stays behind `proxy.ts` (session) — no proxy change.

### B3. Pure — new `lib/logic/version-skew.ts`
```ts
export const RELOAD_MARK_KEY = 'cc:reloadedFor';
export const VERSION_CHECK_THROTTLE_MS = 60_000;
export const ACTION_MISMATCH = '__action_mismatch__';
export function parseVersionResponse(json: unknown): string | null   // non-empty string `version` field, else null
export type SkewAction = 'none' | 'reload' | 'prompt';
export function skewAction(i: { clientVersion: string; serverVersion: string | null; unsafe: boolean; reloadedFor: string | null }): SkewAction
// 'none'   if clientVersion === 'dev' || !serverVersion || serverVersion === clientVersion
// 'prompt' if reloadedFor === serverVersion (already reloaded once for it → no loop) || unsafe
// 'reload' otherwise
```

### B4. Client — new `components/version-watcher.tsx` (`'use client'`), mounted once in `app/layout.tsx` after `{children}` (root, so /login is covered; self-contained banner — `ToastProvider` only exists under `(main)`).
- `CLIENT_VERSION = process.env.CC_APP_VERSION ?? 'dev'`; if `'dev'` render null and attach nothing.
- Dirty tracking: `document.addEventListener('input', h, true)`; add `e.target` to a `Set<Element>` when it is a `textarea`, an `input` whose type is `''|text|search|url|email|tel|number`, or `isContentEditable`.
  `hasUnsavedInput()`: drop `!el.isConnected` entries, true if any remaining has non-empty `value.trim()` (`textContent` for contenteditable).
- `check(serverOverride?: string)`: skip when `document.visibilityState !== 'visible'`; throttle `VERSION_CHECK_THROTTLE_MS` unless `serverOverride`.
  `fetch('/api/version', { cache: 'no-store', redirect: 'manual' })`; `!res.ok` (incl. opaque redirect to /login) → server = null; else `parseVersionResponse(await res.json())`.
  `server = fetched ?? serverOverride ?? null`. If `server === CLIENT_VERSION` → `sessionStorage.removeItem(RELOAD_MARK_KEY)`.
  `a = skewAction({ clientVersion: CLIENT_VERSION, serverVersion: server, unsafe: hasUnsavedInput(), reloadedFor: sessionStorage.getItem(RELOAD_MARK_KEY) })`.
  `'reload'` → `sessionStorage.setItem(RELOAD_MARK_KEY, server)`, `location.reload()`. `'prompt'` → `setStale(true)`.
- Triggers: `visibilitychange` (visible), `focus`, `online`, `pageshow` (`e.persisted`), and `unhandledrejection` / `error` where `unstable_isUnrecognizedActionError(reason ?? error)` → `check(ACTION_MISMATCH)` (mismatch is certain even if /api/version is unreachable).
- Banner when stale: fixed, `bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4`, centered, z-50: text `새 버전이 배포됐어요` + button `새로고침` (sets the mark, reloads). A later safe check auto-reloads.
- Known limit: an action error caught by a component's own try/catch or an error boundary doesn't reach the window listeners; the resume/focus check covers the common case.

---

## C. No-cost performance (ranked by measured/estimated gain)

Interactions re-render the current route inside each action response and actions queue one at a time (facts), so every home-render saving below also applies to each tick/add on home. Narrowing `revalidateAll`'s path list (`app/actions/revalidate.ts`) gains nothing — the other paths are dynamic and not re-rendered.

### C1. Slim client props on home — RSC −~55 KB (157 → ~100 KB), HTML similar
Both changes are required together: StatusWarnChip and ChecklistPanel receive the **same** `tasks` objects, and React Flight serializes each object once, so slimming only one saves ~0.
- `lib/logic/progress.ts`: widen params, no logic change — `progress(tasks: Pick<Task,'status'>[])`, `projectProgress(projectId, tasks: Pick<Task,'projectId'|'status'>[])`, `shouldShowBacklogBar(project, tasks: Pick<Task,'projectId'>[], backlog)`; `export type TaskLite = Pick<Task, 'projectId' | 'status'>`.
- `components/project-progress-list.tsx`, `components/home/status-warn-chip.tsx`: prop `tasks: TaskLite[]`.
- `lib/logic/checklist.ts`: `export function checklistTasks(tasks: Task[], today: string): Task[]` = `status !== 'done' || (doneAt && kstDate(doneAt) === today)` (reuse the file's `kstDate`; exactly the set `bucketTasks` can show).
- `lib/logic/calendar.ts`: `export function calendarNotes(notes: Note[]): Note[]` = `!!n.date && n.status !== 'archived' && n.status !== 'done'` (same filter as `calendarEvents`, `calendar.ts:183-184`); `calendarEvents` may reuse it.
- `app/(main)/page.tsx`: `StatusWarnChip tasks={tasks.map(({ projectId, status }) => ({ projectId, status }))}`, `ChecklistPanel initialTasks={checklistTasks(tasks, today)}`, `WeekStrip notes={calendarNotes(notes)}`. Server-side computations (`checklist(...)`, `buildQueueLaneCards`, counts) keep the full arrays.
- Memoize `checklistTasks(...)` result in a const so ChecklistPanel's `initialTasks !== syncedFrom` resync (`checklist-panel.tsx:276`) sees one array per render.

### C2. Collapse the home waterfall to one DB stage — est. −150–300 ms per render (3 of 4 sequential round trips; ~53 → ~19 queries)
- `lib/logic/project-detail.ts`:
  ```ts
  export function detailsByProjectId(raw: Record<string, unknown>): Record<string, ProjectDetail>  // strip PROJECT_DETAIL_META_PREFIX; keep only non-null objects
  export function projectDueFromDetails(projects: Project[], detailById: Record<string, ProjectDetail>, resolved: ResolvedProjectItems | null, today: string, overdueDays = 7): DueChecklist
  // exactly loadProjectDue's body: non-archived projects → meChecklistDue(..., hiddenProjectItemKeys(resolved, today))
  ```
- `lib/telegram/digest.ts` `loadProjectDue`: keep signature and its per-key reads (DigestRepo's `listMetaByPrefix` is optional); body ends in `projectDueFromDetails(...)`.
- `app/(main)/page.tsx`: `const today = todayKST()` first; `const projectsP = <projects read>`; add to the single `Promise.all`:
  `repo.listMetaByPrefix(PROJECT_DETAIL_META_PREFIX)`, `repo.getMeta<ResolvedProjectItems>(RESOLVED_PROJECT_ITEMS_META_KEY)`, `projectsP.then((p) => getStatusPanelData(repo, p))`.
  Then `allDetails = detailsByProjectId(raw)`; `details` = `allDetails` restricted to the existing `detailProjectIds` (same semantics as today); `projectDue = projectDueFromDetails(projects, allDetails, resolved, today)`. Delete the stage-2/3 awaits and the `loadProjectDue` import. No other behavior change.

### C3. Per-request read dedupe layout ↔ page — −4 queries/render, ~−8 KB RSC (BottomNav projects become Flight back-references)
- New `lib/repo/request-cache.ts`: `import { cache } from 'react'`; `export const cachedProjects = cache(() => getRepo().listProjects())`, same for `cachedNotes`, `cachedPapers`, `cachedReviews`. Server-only (never import from a client component).
- Use in `app/(main)/layout.tsx` and `app/(main)/page.tsx` only. Actions keep using `getRepo()` directly (their re-render then starts with an empty cache → fresh reads).

### C4 (decision needed, not in scope by default). Skip revalidation for purely optimistic actions
`toggleTaskDoneAction`, routine toggle/count, project-checklist resolve already update client state; without `revalidateAll()` the action response carries no re-render (docs `server-actions.md:74`) → instant and no queueing. Cost: lane badge counts/other lanes stay stale until the next navigation/focus. Ask the user.

Not recommended: `deploymentId`, `'use cache'`/ISR on home (single-user, every view must be fresh), Edge runtime (Supabase client + crypto), trimming `projects` fields (≈10 KB, touches many component types).

Measurement (reviewer, Stage 2): `npm run build && LOCAL_PROBES=0 npm start` (:3100, real `.env.local`), session cookie minted from `SESSION_SECRET` in a scratch script; record `/` RSC bytes + time before/after; prod again after deploy. Targets: `/` RSC ≤ 105 KB, HTML ≤ 165 KB, warm RSC total time reduced vs 1114 ms baseline.

---

## Test list (vitest; inputs → expected)

`scripts/lib/cc-hook.test.mjs`
1. `statusContentHash(S)` → 64-hex; equal for structurally equal objects; differs when one checklist item's status changes.
2. `statusPushKey('C:\\Work\\A\\')` === `statusPushKey('c:/work/a')`; ≠ `statusPushKey('/home/u/a')`; length 16.
3. `shouldPushStatus`: `{null,'h',undefined}`→false; `{undefined,'h',undefined}`→true; `{'p1','h','h'}`→false; `{'p1',null,null}`→false; `{'p1','h2','h1'}`→true.

`lib/logic/project-detail.test.ts`
4. `mergePushedStatus(null,'p1',S,NOW)` → `{projectId:'p1', collectedAt:NOW, openItems:{}, status:S}`.
5. existing `{collectedAt:'2026-11-01T08:00:00.000Z', openItems:{코드:['a']}, status:OLD}` → same collectedAt/openItems, `status:S`.
6. `checklistBarMetrics(3 items/1 done, [])` → `{'bar:체크리스트:done':1,'bar:체크리스트:open':2}`; globs `['체크리스트=docs/X.md']` → null; `['docs/BACKLOG.md#코드']` → bar; `['docs/a=b/x.md']` → bar (label has '/'); empty checklist → null; `null` status → null.
7. `detailsByProjectId({'project:detail:p1':D1,'project:detail:p2':null,'project:detail:p3':'x'})` → `{p1:D1}`.
8. `projectDueFromDetails` fixture: archived project's due item excluded; resolved `done` key hidden; snooze with `until` past today shown; output equals the old `loadProjectDue` on a fake repo with the same data.

`lib/logic/cc-status-schema.test.ts`
9. `ccStatusSchema.safeParse(parseCcStatus(variantJson))` succeeds for a file using `title`/`blocked`/`due`/`in_progress` aliases, a 250-char text, and 130 checklist items (parser caps/trims to schema limits).
10. Rejects `checklist[0].status = 'later'` and `due = '11/02'`.

`app/api/agent-inbox/status/route.test.ts` (fake repo via `vi.mock('@/lib/repo')`, pattern of `app/api/ingest/route.brief.test.ts`)
11. AGENT_TOKEN unset → 503; wrong bearer → 401; body > 128 KB → 413; invalid JSON → 400; `status.checklist` item with bad status → 400.
12. Path matching no project → 200 `{ok:true, project:null}`, `setMeta` not called.
13. Existing detail with `openItems` → after POST meta has new `status`, same `openItems`/`collectedAt`.
14. Activity row exists, no own 체크리스트 glob → `upsertProjectActivity` called with merged metrics (other metric keys kept); project with `체크리스트=` glob → not called; no activity row → not called.
15. WSL path form: project path `/home/u/proj`, POST path `/home/u/proj` → matched; Windows project path `C:\W\p`, POST `/mnt/c/W/p` → matched.

`scripts/lib/net-retry.test.mjs` (inject `sleep = vi.fn(async () => {})`)
16. throws `TypeError('fetch failed')` twice then 200 → `{attempts:3}`, sleep called with 5000 then 15000.
17. throws `Error('boom')` (non-retryable) → rejects after 1 attempt, no sleep.
18. 503, 503, 503 → returns the last 503 res, attempts 3. 404 → returned at attempt 1.
19. error with `cause.code = 'ENOTFOUND'` → retryable; `name = 'TimeoutError'` → retryable.

`scripts/lib/run-log.test.mjs` (tmp dir under `os.tmpdir()`)
20. `formatRunLogLine({at:'T', ok:false, stage:'config', reason:'a\nb "c"', counts:{}, ms:5, attempts:3})` → `T fail stage=config attempts=3 ms=5 reason="a b 'c'"`; reason > 200 chars truncated.
21. `appendRunLog` with `maxBytes=50`: after writing 3 × 30-byte lines → `file.1` exists, `file` holds only the newest line(s); missing dir is created.

`lib/logic/version-skew.test.ts`
22. `skewAction`: dev client → none; server null → none; equal → none; differ+safe+no mark → reload; differ+unsafe → prompt; differ+mark===server → prompt; differ+mark==='old' → reload; `ACTION_MISMATCH` + safe → reload.
23. `parseVersionResponse({version:'dpl_1'})` → 'dpl_1'; `{version:''}`, `{}`, `null`, `'x'` → null.

`lib/logic/checklist.test.ts` / `calendar.test.ts` / `progress.test.ts`
24. `checklistTasks`: open kept; done with `doneAt` today KST (e.g. `2026-11-01T16:30:00Z` for today `2026-11-02`) kept; done yesterday dropped; done with null doneAt dropped. `checklist(checklistTasks(T), …)` deep-equals `checklist(T, …)` for a mixed fixture.
25. `calendarNotes`: undated dropped, done/archived dropped, dated inbox/sent kept; `calendarEvents` output unchanged with the filtered list.
26. `projectProgress('p1', [{projectId:'p1',status:'done'},{projectId:'p1',status:'todo'}])` → `{done:1,total:2,pct:50}` (TaskLite input type-checks).

Manual (implementer): `npm run typecheck && npm test`; `node scripts/check-isolation.mjs`;
`echo '{"session_id":"t1","cwd":"<managed repo>","stop_hook_active":true}' | node scripts/cc-inbox.mjs stop` with a changed cc-status → record file appears in tmpdir after ~1 s, second run spawns nothing;
`node scripts/cc-inbox.mjs push-status <managed repo>` prints `push-status: 200` (against local dev :3100 with `CLOUD_URL` overridden in the shell);
collector with `CLOUD_URL=http://127.0.0.1:9` → exits ~20 s later, `.data/collector.log` gets one `fail stage=config attempts=3` line.

## Spec problems

| # | Problem | Evidence | Resolution |
|---|---|---|---|
| P1 | A push placed inside the existing Stop flow never runs on the turn after the nudge (`stop_hook_active` true) — the very turn that refreshes the file | `scripts/cc-inbox.mjs:334` | Push before that check (A1.5) |
| P2 | Ingest's zod schema is route-private; a second route would duplicate it | `app/api/ingest/route.ts:40-55` | Move to `lib/logic/cc-status-schema.ts` (A1.1) |
| P3 | "Update only status" leaves the 체크리스트 progress bar (collector-derived, in `project_activity.metrics`) stale until the next collector run | `scripts/collector.mjs:345-351` | Route patches the bar metrics when an activity row exists (A1.3 step 7); server approximates "project names its own 체크리스트 bar" by glob label |
| P4 | Collector exits from three places before any log could be written | `scripts/collector.mjs:43,409,456` | `StageError` + single top-level log/`exitCode` (A2.3) |
| P5 | Slimming only StatusWarnChip's `tasks` saves nothing: ChecklistPanel gets the same objects and Flight serializes each once | page.tsx:164,229; RSC shows `$8:props:...` back-references | Slim both (C1) |
| P6 | "revalidatePath scope re-renders more than needed" — in Next 16 only the current route is re-rendered per action regardless of path count | `server-actions.md:150` | No change to `revalidateAll`; speed comes from C1/C2; optional C4 needs a user decision |
| P7 | Brief suggests deploymentId/skew features; Hobby has no skew-protection routing and Next already reloads on navigation build-id mismatch | prod HTML (no `data-dpl-id`); `fetch-server-response.js:175`; `deploymentId.md` | Don't set `deploymentId`; tiny version route + watcher for resume and action errors (B) |
| P8 | `/api/version` sits behind the session proxy, so a stale `/login` tab can't read it | `proxy.ts:15-30` | Action-mismatch path decides without the route (`ACTION_MISMATCH`); no proxy change |
| P9 | `VERCEL_DEPLOYMENT_ID` build-time availability unverified locally | — | Fallback chain → commit SHA → 'dev'; reviewer checks `/api/version` after deploy returns non-'dev' |
| P10 | `loadProjectDue` re-lists projects and re-fetches details already needed by the page | `lib/telegram/digest.ts:54-70`, page.tsx:95,101 | Pure `projectDueFromDetails` shared by both (C2) |

## Review rubric (risk order)

1. Stop/SessionStart hooks: no network in the hook process itself, never print on the push path, never throw; push precedes the `stop_hook_active` return; Node 18 syntax only (no `import.meta.dirname`, no TS).
2. New route: 503/401 bearer branches, 128 KB cap, zod via shared schema, writes only `project:detail:<matched id>` and (conditionally) that project's metrics; `openItems`/`collectedAt` preserved.
3. No secrets in logs: collector reasons/log lines, `push-status` output, route errors.
4. Version watcher: never reloads while a dirty non-empty field exists; reload-loop guard via `RELOAD_MARK_KEY`; disabled on 'dev'; `/api/version` no-store and repo-free.
5. Home output identical except payload: lane counts, checklist items (incl. done-today), week strip, status chip contents match before/after (screenshot or RSC diff on the local build).
6. C2: exactly one `Promise.all` stage in `page.tsx`; `details` restricted to the same ids as before; `projectDue` equals the old `loadProjectDue` (test 8).
7. Retry: only network errors/502-504, max 3 attempts, total wait ≤ 20 s; ingest still exits non-zero (`exitCode`) on failure.
8. Run log rotates at 256 KB, lives in `.data/`, one line per run including env failure.
9. C3 cache helpers imported only from server components; actions untouched.
10. `npm run typecheck`, `npm test`, `node scripts/check-isolation.mjs` green; RSC `/` ≤ 105 KB on the local build.

## Files

New: `lib/logic/cc-status-schema.ts`(+test), `app/api/agent-inbox/status/route.ts`(+test), `scripts/lib/net-retry.mjs`(+test), `scripts/lib/run-log.mjs`(+test), `app/api/version/route.ts`, `lib/logic/version-skew.ts`(+test), `components/version-watcher.tsx`, `lib/repo/request-cache.ts`.
Edited: `app/api/ingest/route.ts` (import schema), `lib/logic/project-detail.ts`(+test), `scripts/lib/cc-hook.mjs`(+test), `scripts/cc-inbox.mjs`, `scripts/collector.mjs`, `next.config.ts`, `app/layout.tsx`, `lib/logic/progress.ts`, `components/project-progress-list.tsx`, `components/home/status-warn-chip.tsx`, `lib/logic/checklist.ts`(+test), `lib/logic/calendar.ts`(+test), `lib/telegram/digest.ts`, `app/(main)/page.tsx`, `app/(main)/layout.tsx`.
Docs (lead/main session): CLAUDE.md Machine APIs (`POST /api/agent-inbox/status`, `GET /api/version`), collector log path, `docs/SETUP.md` §9 note that the Stop hook now pushes cc-status.
No new env vars, no migration, no new dependency.
