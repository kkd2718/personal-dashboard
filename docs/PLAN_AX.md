# PLAN_AX — PC-off automation (Telegram NL updates, Google Calendar write, reply tracker, weekly review, prompt hook)

Planner: Opus. Implementer: Sonnet. Korean UI strings, English code/comments. Pure logic in
`lib/logic/*.ts` with `*.test.ts`. Every slice is independently shippable (typecheck + `npm test`
+ `node scripts/check-isolation.mjs` green, deploy, manual check). Do not redesign shapes below;
if one does not fit the code, stop and report.

## 0. Verified facts (read in code, 2026-10-15)

| Fact | Evidence |
|---|---|
| Free text → memo via `createNoteFromText(text, null, 'telegram')` | `app/api/telegram/webhook/route.ts:93-101` |
| `parseUpdate` only reads `message.text`; no `update_id`, no `callback_query` | `lib/telegram/format.ts:299-308` |
| Webhook registered with `allowed_updates: ['message']` → callback queries are **never delivered** today | `scripts/telegram-setup.mjs:84` |
| `sendMessage` has no `reply_markup`, returns no `message_id`; dev guard `NODE_ENV==='development' && TELEGRAM_DEV_SEND!=='1'` | `lib/telegram/client.ts:31-58` |
| Repo has `updateTask`, `updateDeadline`, `getMeta/setMeta/listMetaByPrefix`; **no** `deleteMeta`, **no** single calendar-event upsert, no task delete | `lib/repo/index.ts:21-133` |
| `updateTask({status:'done'})` auto-sets `doneAt` (Supabase); Task statuses only `todo|doing|done` | `lib/repo/supabase.ts:421-429`, `lib/types.ts:51` |
| Calendar sync = `replaceCalendarEvents(account, from, to, events)`: deletes **all of that account's rows overlapping [from,to]**, then inserts | `lib/repo/local.ts:552-559`, `supabase/migrations/0004_phase3.sql:55-78` |
| Event id `<account>:<calendarId>:<eventId>:<startISO>`; `calendarId` segment `'primary'` ⇒ visible by default; else visible only if `calendarName ∈ app_meta 'calendar:visible'` | `lib/google/sync.ts:47`, `lib/logic/calendar.ts:19-55` |
| Apps Script window: `from = now-DAYS_BACK(7)`, `to = now+DAYS_AHEAD(60)`, `account` = Script Property `ACCOUNT` | `integrations/google/Code.gs:84-104` |
| Sync body is `z.object` (non-strict) → unknown keys are stripped, so a new `waiting` key is ignored by the old server | `app/api/google/sync/route.ts:47-71` |
| `proxy.ts` allow-lists `/api/google/sync` only (prefix match) — a new `/api/google/waiting` would be redirected to /login | `proxy.ts:16-23` |
| Crons: daily `0 22 * * *`, evening `0 12 * * *` (≈21:00 KST); evening idempotent via `telegram:evening:lastSent` | `vercel.json`, `lib/telegram/evening.ts:8-35` |
| Project-checklist hide set = **all** keys of `project-checklist:resolved` (no state filter), computed only in `loadProjectDue`; `overdueDays` hard-coded 7 | `lib/telegram/digest.ts:41-56`, `lib/logic/project-detail.ts:116-130` |
| `resolveProjectItemAction` = requireUser + memo(status sent) + resolved-map write | `app/actions/project-checklist.ts:26-44` |
| `/api/agent-inbox` returns **all** open agent tasks + **all** `sent` memos every call; stamps `deliveredAt` only when null | `app/api/agent-inbox/route.ts:39-48` |
| SessionStart writes marker `os.tmpdir()/cc-session-<id>.json` only for managed projects; Stop hook trusts any marker | `scripts/cc-inbox.mjs:131-205,207-237` |
| Today 2026-10-15 is a Thursday; Sun-first week Sun 10-11..Sat 10-17 | computed |

## 1. Spec problems (brief vs code) — resolution adopted in this plan

| # | Problem | Evidence | Resolution |
|---|---|---|---|
| P1 | Callback buttons cannot work: webhook only subscribes to `message`. | `scripts/telegram-setup.mjs:84` | Slice A changes to `['message','callback_query']`; rollout: rerun `npm run telegram:setup`. |
| P2 | No way to delete pending/expired `app_meta` rows. | `lib/repo/index.ts:113-118` | Add `deleteMeta(key)` to Repo, LocalRepo, SupabaseRepo. |
| P3 | Optimistic calendar row: `replaceCalendarEvents` only removes rows whose `account` equals the Apps Script `ACCOUNT` label; the OAuth refresh token has no notion of that label. A wrong label = permanent duplicate. | `0004_phase3.sql:66-67` | New env `GOOGLE_OAUTH_ACCOUNT` (must equal that Google account's Apps Script `ACCOUNT`). Unset ⇒ insert to Google only, no optimistic row. Add `Repo.upsertCalendarEvent(e)`. |
| P4 | Optimistic row may be hidden if `calendar:visible` is set and `calendarName` differs. | `lib/logic/calendar.ts:50-55` | Copy `calendarName` from an existing row of the same account + calendarId segment; fallback `organizer.email` from the insert response. |
| P5 | `VERCEL_OIDC_TOKEN` is (to my knowledge) an env var only at build/`vercel env pull`; at function runtime Vercel passes it as request header `x-vercel-oidc-token`. Crons/webhooks would then see no env token. | Vercel runtime behaviour, unverified here | `jevToken(env, headers?)`: `AI_GATEWAY_API_KEY` → `VERCEL_OIDC_TOKEN` env → `x-vercel-oidc-token` header. **Recommend setting `AI_GATEWAY_API_KEY`.** Verify in Slice A step 1. |
| P6 | Jev answer shape for `choice`/`score` unverified. | brief | Single tolerant parser `parseJevResponse`; Slice A step 1 = `scripts/jev-probe.mjs` against prod key to pin the shape before wiring. Unknown/missing probability ⇒ confidence `null` ⇒ treated as low (memo fallback). **Resolved 2026-10-15: shapes verified, see §6 step 1; threshold on top probability + margin, daily cap 200.** |
| P7 | Cost: Jev through AI Gateway is metered (owner declined "a separate API bill"). | brief | Lead to confirm with owner that AI Gateway credits cover it. Plan minimises calls: **one** Jev request per message (intent + target questions in the same `questions` map); deterministic pre-gate skips Jev for obvious memos. |
| P8 | Slice B is meant to ship before A, but has no trigger without A. | brief | Add explicit command `/cal <text>` in Slice B that inserts **immediately** (explicit command, like `/done`). Lead: confirm this is acceptable; otherwise B ships library-only and is exercised first in A. |
| P9 | "안 함" on a Task: no dropped/cancelled status, no delete. | `lib/types.ts:51` | Task 안 함 ⇒ `status:'done'` + append `\n[안 함 YYYY-MM-DD]` to `description`. Deadline 안 함 ⇒ `done:true`. No schema change. |
| P10 | "+1주" on a project-checklist item: the item lives in another repo's `docs/cc-status.json`; resolved map has no snooze. | `lib/logic/project-detail.ts:93-97` | Extend `ResolvedProjectItem` with `state:'snooze'` + optional `until`. New pure `hiddenProjectItemKeys(map, today)` (snooze hides only while `until > today`), used in `loadProjectDue`. Snooze also sends a memo to the project's session ("마감을 YYYY-MM-DD로 미뤄 주세요"). |
| P11 | `loadProjectDue` hard-codes 7 overdue days; weekly review wants older items. | `lib/telegram/digest.ts:51-55` | Add optional `overdueDays = 7` param; weekly passes 30. |
| P12 | Telegram retries a webhook that is slow/non-2xx; with Jev latency a retry would create a duplicate proposal. | Telegram behaviour | Parse `update_id`; keep last 50 in `app_meta 'telegram:updates:recent'`; skip seen ids. `export const maxDuration = 30` on the webhook route. |
| P13 | Hobby cron count limit not verifiable from repo. | `vercel.json` | Do **not** add a cron. Weekly review runs inside `/api/cron/evening` when the KST weekday is Sunday, idempotent via `telegram:weekly:lastSent`. |
| P14 | Prompt hook would duplicate items SessionStart already printed (endpoint returns everything each call). | `app/api/agent-inbox/route.ts:39-40` | SessionStart also writes `shownIds` to the marker; prompt mode injects only ids not in `shownIds`. |
| P15 | Writing a marker for unmanaged dirs (so prompt mode can skip them) would make the Stop hook nudge there. | `scripts/cc-inbox.mjs:218-221` | Stop hook returns when `!marker.projectId`. |
| P16 | Brief's waiting item lacks a precise instant (`since` is a KST date; Gmail `after:` is day-granular and not KST) and a dedupe key. | brief | Add `createdAt` (ISO) and `reply.messageId`, `reply.category`, `reply.positive`. Replies must have `receivedAt >= createdAt`. |
| P17 | `waiting:replies` is one JSON key written by two Apps Script accounts + webhook (read-modify-write). | design | Accepted (single user, hourly). Writers re-read immediately before writing; tests cover merge of an unchanged item. |
| P18 | Weekly buttons must survive until Monday; 24h TTL would kill Sunday-night items by Monday night. | brief | TTL per record: proposal 24h, weekly 72h. Delete records older than 7 days on each new save. |
| P19 | `Code.gs` header and sync route doc say "No OAuth client lives in this app". | `Code.gs:6`, `route.ts:73-74` | Update both comments in Slice B. |
| P20 | Ambiguities in Korean expressions. | brief | Decided in §3.1: **Sun→Sat weeks for 이번주/다음주/저번주 (owner decision 2026-10-15, `startOfSundayWeek`)**; bare weekday = next occurrence **after** today; bare hour 1–6 ⇒ PM; "2시 3시" = two times (two events), "2시~3시"/"2-3시"/"2시부터 3시까지" = range. Lead may override; rules are each a single branch. |
| P21 | "Jev unavailable → say so" on every message is noise when the feature is simply not configured. | brief | No token ⇒ byte-identical to today's reply. Token present but call failed / low confidence / intent≠memo fell back ⇒ append `\n<i>(업데이트로 확신하지 못해 메모로 저장했어요)</i>`. |

## 2. Slice order

0. `ko-datetime` + date helpers (pure, no UI) — prerequisite of B/A/D.
1. **E** prompt hook (PC-side, independent).
2. **B** Google Calendar write + `/cal`.
3. **A** Jev + inline keyboard + pending + NL proposals.
4. **C** reply-waiting tracker.
5. **D** weekly review.
6. Monthly shift-sheet alert (§8a, server-only).
7. Mail triage alerts (§8b, Apps Script 5-min trigger + Jev budget `mail`).

Docs/env/CLAUDE.md lines are written in the slice that introduces them.

---

## 3. Slice 0 — Korean date/time parser

Files: `lib/logic/dates.ts` (+2 helpers), `lib/logic/ko-datetime.ts`, `lib/logic/ko-datetime.test.ts`, `lib/logic/dates.test.ts` (+cases).

```ts
// dates.ts
export function weekdayOf(dateStr: string): number;            // 0=Sun..6=Sat, UTC-anchored like the rest
export function nowKstTime(now?: Date): string;                // 'HH:mm' Asia/Seoul (wraps kstDateTime)

// ko-datetime.ts
export type DateShift = { unit: 'day' | 'month'; n: number };
export interface KoDateTime {
  date: string | null;                       // first absolute date
  shift: DateShift | null;                   // postpone phrase
  times: string[];                           // 'HH:mm', order of appearance, de-duplicated
  range: { start: string; end: string } | null;
  durationMin: number | null;
  spans: Array<[number, number]>;            // half-open char ranges consumed in `text`
}
export function parseKoDateTime(text: string, today: string): KoDateTime;
export function stripSpans(text: string, spans: Array<[number, number]>): string;
export function applyShift(base: string, shift: DateShift): string;        // addDaysStr / addMonthsStr
export function rescheduleBase(currentDue: string | null, today: string): string; // max(currentDue ?? today, today)
export function addMinutesKst(date: string, time: string, minutes: number): { date: string; time: string };
```

### 3.1 Rules (each exactly one branch; no raw `Date` arithmetic — use dates.ts)
- URLs are blanked before matching (no dates parsed inside `https?://\S+`).
- Pass order: shift phrases → ISO date → `M/D` → `M월 D일` → relative words → weekdays → `D일` → ranges → times → durations. A span consumed by an earlier pass is not re-matched.
- **Shift**: `(\d+|하루|이틀|사흘|나흘|일주일|한\s?주|두\s?주|보름|한\s?달|\d+\s?(?:주|주일|일|달|개월))` followed by `(?:\s*(?:뒤로|후로|더))?\s*(미뤄|미루|미룸|연기|늦춰)` ⇒ day/month shift; `\+(\d+)\s?(일|주|달)`; `다음\s?주로\s*(미뤄|연기|…)` ⇒ 7 days. Words: 하루1 이틀2 사흘3 나흘4 일주일/한주7 두주14 보름15; 달/개월 ⇒ month.
- **ISO** `YYYY-MM-DD` / `YYYY.MM.DD` / `YYYY/MM/DD` ⇒ as given (validated).
- **`M/D`, `M월 D일`** (no year): this year; **if the result is before `today − 60 days`, next year**. Invalid day (2월 30일, 13/45) ⇒ not parsed.
- **오늘 0, 내일 1, 모레 2, 내일모레 2, 글피 3** (days from today).
- **Weekday** `(월|화|수|목|금|토|일)(요일|욜)` or `\((월|…|일)\)`: weeks are **Sunday→Saturday** (`startOfSundayWeek`, owner decision). `이번\s?주 X` ⇒ X in the Sun-first week of today (may be past); `다음\s?주 X` ⇒ same for today+7; `다다음\s?주 X` ⇒ +14; `저번\s?주|지난\s?주 X` ⇒ −7; bare ⇒ first X **strictly after** today. "일주일" must not match 일요일.
- **`D일`** alone (`(?<![\d/.월])(\d{1,2})일(?!\s?(?:간|동안|뒤|후|미뤄|연기))`): this month if D ≥ today's day and valid, else the first of the next two months where D is valid.
- **Times**: `HH:MM` (24h, as is); `(오전|아침|새벽|오후|낮|저녁|밤)?\s?(\d{1,2})시(?!간)\s?(반|(\d{1,2})분)?` (+ optional 쯤/경); `정오` ⇒ 12:00. Hour mapping: with 오전/아침/새벽 ⇒ AM (12⇒00); with 오후/낮/저녁/밤 ⇒ PM (h<12 ⇒ h+12; 밤 12시 not parsed); bare h ≥ 13 ⇒ as is; bare 1–6 ⇒ +12; bare 7–12 ⇒ as is. A meridiem word carries to following bare hours **only if** the carried result is later than the previous time; otherwise the bare rule. h > 23 or m > 59 ⇒ not parsed.
- **Range**: `T1\s?(~|-|–|부터)\s?T2(까지)?` and `(\d{1,2})\s?-\s?(\d{1,2})시` ⇒ `range`; both also pushed to `times`. End ≤ start ⇒ end + 12h if < 24h, else range dropped.
- **Duration**: `(\d+)\s?시간(\s?반)?`, `(\d+)\s?분\s?(간|동안|짜리)` ⇒ minutes. `4시 30분` is a time, never a duration.
- `stripSpans`: removes spans, then a particle glued to a removed span (`에|까지|로|으로|부터|에서|쯤`), collapses whitespace, trims.

### 3.2 Tests (`today = '2026-10-15'` Thu unless noted)
| Input | Expected |
|---|---|
| `10/31` · `10월 31일` · `10월31일까지` | date `2026-10-31` |
| `31일` | `2026-10-31` |
| `3일` | `2026-11-03` |
| `31일` (today `2026-11-15`) | `2026-12-31` |
| `1/5` (today `2026-12-30`) | `2027-01-05` |
| `9/1` · `8/1` | `2026-09-01` · `2027-08-01` |
| `2월 30일` · `13/45` | date null |
| `2027-01-05` | `2027-01-05` |
| `오늘` `내일` `모레` `내일모레` `글피` | `10-15` `10-16` `10-17` `10-17` `10-18` |
| `다음주 화요일` · `다음 주 화욜` | `2026-10-20` |
| `이번주 금요일` · `이번주 월요일` | `2026-10-16` · `2026-10-12` |
| `화요일` · `목요일` · `금요일` | `10-20` · `10-22` · `10-16` |
| `다음주 화요일` (today `2026-10-17` Sat) · (today `2026-10-18` Sun) | `2026-10-20` · `2026-10-27` |
| `이번주 일요일` · `저번주 금요일` · `지난주 월요일` | `2026-10-11` · `2026-10-09` · `2026-10-05` |
| `오후 11시~1시` (range would cross midnight) | range null, times `[23:00]` only (end dropped, never a second event) |
| `2주 미뤄` `일주일 미뤄` `+3일` `하루 연기` `이틀 미뤄줘` `다음주로 미뤄` `+1주` | shift day 14/7/3/1/2/7/7, date null |
| `한 달 미뤄` | shift month 1 |
| `3일 뒤로 미뤄` | shift day 3, date null (not `D일`) |
| `오후 3시` `3시 반` `15:00` `4시 30분` `오전 11시` `9시` `12시` `저녁 7시 반` `새벽 2시` `정오` | `15:00` `15:30` `15:00` `16:30` `11:00` `09:00` `12:00` `19:30` `02:00` `12:00` |
| `밤 12시` · `25시` | times `[]` |
| `2시 3시` · `오후 2시 3시` | times `[14:00,15:00]`, range null |
| `오전 11시 2시` | `[11:00,14:00]` |
| `2시~3시` · `2시부터 3시까지` · `2-4시` | range `14:00–15:00` · `14:00–15:00` · `14:00–16:00` |
| `11시~1시` | range `11:00–13:00` |
| `1시간` `1시간 반` `30분 동안` `90분간` | duration 60/90/30/90 |
| `4시 30분` | duration null |
| `내일 오후 3시 치과 1시간` | date `10-16`, times `[15:00]`, dur 60, `stripSpans` ⇒ `치과` |
| `다음주 화요일 2시 3시 미팅` | date `10-20`, times `[14:00,15:00]`, title `미팅` |
| `https://x.com/10/31 확인` | date null |
| `일주일 미뤄` | not a weekday (date null) |
| `rescheduleBase('2026-10-01', today)` · `(null)` · `('2026-11-01')` | `10-15` · `10-15` · `11-01` |
| `addMinutesKst('2026-10-15','23:30',60)` | `{2026-10-16, 00:30}` |
| `applyShift('2026-01-31',{month,1})` | `2026-02-28` |
| `weekdayOf('2026-10-15')` | 4 |

Manual check: `npm test`.

---

## 4. Slice 1 — E: UserPromptSubmit hook

Files: `scripts/lib/cc-hook.mjs` (+pure helpers), `scripts/lib/cc-hook.test.mjs`, `scripts/cc-inbox.mjs` (`prompt` mode, hook-mode marker change, Stop guard), `docs/SETUP.md` §9 (+snippets).

```js
// cc-hook.mjs (plain JS, Node >= 18)
/** Items in `data` whose id is not in `shownIds`. */
export function newInboxItems(data /* {tasks:[{id}], memos:[{id}]} */, shownIds /* string[] */) // -> {tasks, memos}
/** All ids of tasks+memos (what SessionStart printed). */
export function inboxIds(data) // -> string[]
/** Stdout JSON for UserPromptSubmit. */
export function promptHookOutput(text) // -> JSON string {hookSpecificOutput:{hookEventName:'UserPromptSubmit', additionalContext:text}}
/** Throttle: true when lastCheckIso is within `ms` of nowMs. */
export function recentlyChecked(lastCheckIso, nowMs, ms = 30000)
```

Marker (`os.tmpdir()/cc-session-<session_id>.json`): `{startedAt, root, projectId: string|null, reminded, shownIds: string[], lastPromptCheckAt?: string}`.

Behaviour:
- `hook` (SessionStart): unchanged output; marker now also gets `shownIds = inboxIds(data)`; for an unmanaged cwd (`data.project == null` with a successful fetch) write `{startedAt, projectId:null, reminded:true, shownIds:[]}`.
- `stop`: add `if (!marker.projectId) return;` before `shouldRemind`.
- `prompt` (new): global kill timer `setTimeout(() => process.exit(0), 1500)`; fetch timeout 1200 ms. Read stdin `{session_id, cwd}`. If marker `projectId === null` ⇒ exit. If `recentlyChecked(marker.lastPromptCheckAt)` ⇒ exit. Fetch `/api/agent-inbox?path=cwd`. On any failure ⇒ exit 0 silently, print nothing. `fresh = newInboxItems(data, marker?.shownIds ?? [])`; none ⇒ update `lastPromptCheckAt`, print nothing. Else print `promptHookOutput(renderBlock(fresh, '## Command Center — 새로 전달된 항목'))` and write marker with `shownIds ∪ new ids`. No marker ⇒ create one (`startedAt = now`, `root = cwd`, `reminded:false`, `projectId = data.project.id`).
- `renderBlock(data, title?)` gets an optional title param (default unchanged).
- Never prints on error; always exit 0; no `--env-file`, no `import.meta.dirname`.

Tests (`cc-hook.test.mjs`):
- `newInboxItems({tasks:[{id:'t1'},{id:'t2'}],memos:[{id:'n1'}]}, ['t1','n1'])` ⇒ `{tasks:[{id:'t2'}], memos:[]}`.
- `newInboxItems(x, [])` ⇒ all; `inboxIds` order tasks then memos.
- `JSON.parse(promptHookOutput('a')).hookSpecificOutput` ⇒ `{hookEventName:'UserPromptSubmit', additionalContext:'a'}`.
- `recentlyChecked(new Date(0).toISOString(), 10000)` ⇒ true; at 40000 ⇒ false; `undefined` ⇒ false.
- `shouldRemind` unchanged tests still pass.

**Revision 2026-10-15 (review):** measured `/api/agent-inbox` latency from the PC is 1.0–1.2 s warm, 1.9 s cold, so a synchronous fetch inside a 1.5 s budget almost always hits the kill timer: nothing is delivered, no marker is written, and every prompt pays 1.5 s. Replace the synchronous fetch with a cache + detached refresh:
- `prompt`: file I/O only (target < 150 ms incl. Node start). Read `os.tmpdir()/cc-inbox-cache-<session_id>.json` `{fetchedAt, cwd, data}`; if present, inject `newInboxItems(cache.data, marker.shownIds)` exactly as above and update `shownIds`. Then, if the cache is absent or older than 30 s and `cc-inbox-refresh-<session_id>.lock` is absent or older than 15 s, write the lock and `spawn(process.execPath, [SCRIPT_PATH, 'refresh', sessionId, cwd], { detached: true, stdio: 'ignore', windowsHide: true }).unref()`.
- `refresh <session_id> <cwd>` (new, internal): `fetchInbox(cwd, 5000)`; on success write the cache atomically (temp + rename), and for `data.project == null` write the unmanaged marker; always remove the lock; silent.
- An item is injected on the first prompt **after** the refresh that saw it (one prompt of lag, accepted). SessionStart also writes the cache so the first prompt has a baseline.
- Pure helper `cacheIsStale(fetchedAtIso, nowMs, ms = 30000)` in cc-hook.mjs (tests: absent ⇒ true, 10 s ⇒ false, 40 s ⇒ true).
- Manual: `time (echo '{"session_id":"t","cwd":"<repo>"}' | node scripts/cc-inbox.mjs prompt)` < 0.3 s with the server reachable **and** with `CLOUD_URL=http://10.255.255.1`.

Docs: SETUP.md §9 add `UserPromptSubmit` blocks for Windows and WSL `~/.claude/settings.json` (`... cc-inbox.mjs prompt`, `"timeout": 3`), noting each environment keeps its own marker (`os.tmpdir()` differs).

Manual: open a session in a managed project; from the dashboard send a memo to that project; next prompt shows "새로 전달된 항목" once; the following prompt (after 30 s) shows nothing. Unmanaged dir: no output, Stop hook silent. `time node scripts/cc-inbox.mjs prompt < input.json` ≤ 1.5 s with CLOUD_URL pointing at a black-hole host.

---

## 5. Slice 2 — B: immediate Google Calendar write

Files: `lib/google/calendar.ts`, `lib/google/calendar.test.ts`, `lib/repo/index.ts` + `local.ts` + `supabase.ts` (`upsertCalendarEvent`, `deleteMeta`), `lib/telegram/format.ts` (`/cal` reply formatter + `CommandName` add `cal`), webhook route (`cal` case), `scripts/google-oauth.mjs`, `scripts/telegram-setup.mjs` (commands), `.env.example`, `docs/SETUP.md` (new §10), `integrations/google/Code.gs` + sync route header comments (P19), CLAUDE.md line.

```ts
// Repo additions (both adapters)
upsertCalendarEvent(event: CalendarEvent): Promise<void>;   // Local: replace by id or push; Supabase: upsert(calendarEventToRow(e), {onConflict:'id'})
deleteMeta(key: string): Promise<void>;                      // Local: delete db.meta[key]; Supabase: delete().eq('key', key)

// lib/google/calendar.ts (server-only guard like lib/telegram/client.ts)
export interface GoogleCalendarConfig { clientId: string; clientSecret: string; refreshToken: string; calendarId: string; account: string | null }
export function googleCalendarConfig(env?: NodeJS.ProcessEnv): GoogleCalendarConfig | null; // null if any of the 3 OAuth vars missing; calendarId = GOOGLE_CALENDAR_ID ?? 'primary'; account = GOOGLE_OAUTH_ACCOUNT ?? null
export interface NewEvent { title: string; date: string; startTime: string | null; endTime: string | null } // null times = all-day
export function buildEventBody(ev: NewEvent): Record<string, unknown>;  // pure
export type CalResult<T> = { ok: true; value: T } | { ok: false; error: 'invalid_grant' | 'http' | 'network' };
export async function getAccessToken(cfg: GoogleCalendarConfig, fetchImpl?: typeof fetch): Promise<CalResult<string>>; // module cache until expires_in-60s
export async function insertCalendarEvent(cfg: GoogleCalendarConfig, ev: NewEvent, fetchImpl?: typeof fetch): Promise<CalResult<{ eventId: string; organizerEmail: string | null }>>;
export function optimisticCalendarEvent(account: string, calendarSegment: string, calendarName: string, googleEventId: string, ev: NewEvent, now: string): CalendarEvent; // pure
export function eventsFromParsed(p: KoDateTime, today: string, nowTime: string): NewEvent[] | { error: string }; // pure, see rules
// lib/google/calendar-write.ts (server): orchestration with repo
export async function createCalendarEvents(repo: Pick<Repo,'listCalendarEvents'|'upsertCalendarEvent'>, cfg: GoogleCalendarConfig, events: NewEvent[], fetchImpl?: typeof fetch): Promise<{ created: NewEvent[]; error: string | null }>;
```

Rules:
- `buildEventBody`: timed ⇒ `{summary, start:{dateTime:'YYYY-MM-DDTHH:mm:00', timeZone:'Asia/Seoul'}, end:{…}, reminders:{useDefault:false, overrides:[{method:'popup', minutes:10}]}}`; all-day ⇒ `start:{date}`, `end:{date: addDaysStr(date,1)}` (exclusive), same reminders.
- `eventsFromParsed`: no date and no time ⇒ error `'날짜를 찾지 못했어요'`. Time without date ⇒ today if `times[0] > nowTime`, else tomorrow. `range` ⇒ one event start/end. Else each of `times` (max 5) ⇒ event `[t, addMinutesKst(date, t, durationMin ?? 60).time]`; if that end falls on the next day, end = `23:59` (`NewEvent` is single-day by design). No times ⇒ one all-day event.
- Optimistic row only when `cfg.account` set: id `${account}:${seg}:${eventId}:${new Date(`${date}T${start}:00+09:00`).toISOString()}` (all-day: `${date}T00:00:00+09:00`), `seg = cfg.calendarId === 'primary' ? 'primary' : cfg.calendarId`; `calendarName` = existing row of same account whose id segment[1] === seg (from `listCalendarEvents(today-7, today+60)`), else `organizerEmail ?? 'Google'`.
- Errors: `invalid_grant` ⇒ reply `구글 인증 만료 — scripts/google-oauth.mjs 다시 실행`. Never log tokens, response bodies, or event titles.
- `/cal <text>`: config null ⇒ save memo (`createNoteFromText`) and reply `캘린더 연동 미설정 — 메모로 저장했어요`. Else parse → `eventsFromParsed` → title = `stripSpans` (empty ⇒ `제목을 찾지 못했어요`) → create → reply `📅 10/16(금) 14:00–15:00 치과 — 캘린더에 추가` (one line per event).
- `scripts/google-oauth.mjs` (Node 24, `node --env-file=.env.local scripts/google-oauth.mjs`): reads `GOOGLE_OAUTH_CLIENT_ID/SECRET`; `http.createServer` on `127.0.0.1:0`; PKCE S256 + random `state`; auth URL `https://accounts.google.com/o/oauth2/v2/auth?…&scope=https://www.googleapis.com/auth/calendar.events&access_type=offline&prompt=consent`; prints URL (and tries `start`/`open`); on callback verifies state, exchanges code at `https://oauth2.googleapis.com/token`, prints only the refresh token to stdout, closes server, exits. Writes nothing to disk. 5-minute timeout.

Tests (`calendar.test.ts`, fetch injected):
- `buildEventBody({title:'치과',date:'2026-10-16',startTime:'14:00',endTime:'15:00'})` ⇒ dateTime strings as above, timeZone `Asia/Seoul`, popup 10.
- all-day `2026-10-31` ⇒ end date `2026-11-01`.
- `googleCalendarConfig({})` ⇒ null; with 3 vars ⇒ calendarId `primary`, account null.
- `getAccessToken`: 200 `{access_token,expires_in:3600}` ⇒ ok; second call no fetch (cache); 400 `{error:'invalid_grant'}` ⇒ `invalid_grant`; fetch throws ⇒ `network`.
- `insertCalendarEvent` posts to `/calendars/primary/events` with `Authorization: Bearer <token>`; 200 `{id:'abc',organizer:{email:'x@example.com'}}` ⇒ `{eventId:'abc', organizerEmail:'x@example.com'}`.
- `optimisticCalendarEvent('main','primary','Cal','abc',{…14:00…})` ⇒ id `main:primary:abc:2026-10-16T05:00:00.000Z`, startTime `14:00`; `isPrimaryCalendarEvent` ⇒ true.
- `eventsFromParsed` for `2시 3시` on `2026-10-20` ⇒ two events 14–15, 15–16; `2시~3시` ⇒ one; time only `15:00` with nowTime `16:00` ⇒ tomorrow; nothing ⇒ error.
- Repo: LocalRepo `upsertCalendarEvent` twice same id ⇒ one row; then `replaceCalendarEvents(account, …window covering it…, [])` ⇒ row gone (the invariant that the next Apps Script sync replaces it); `deleteMeta` removes key.

Docs (SETUP.md §10, Korean): Google Cloud console → new project → enable Google Calendar API → OAuth consent screen **External**, add own account as user, then **Publish app → In production** (Testing-mode refresh tokens expire after 7 days; unverified-app warning is expected for a personal app) → Credentials → OAuth client ID → **Desktop app** → put id/secret in `.env.local` → run `scripts/google-oauth.mjs` → paste refresh token into Vercel env only → set `GOOGLE_OAUTH_ACCOUNT` = that account's Apps Script `ACCOUNT`.

Env (`.env.example`, commented): `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_OAUTH_ACCOUNT`, `GOOGLE_CALENDAR_ID` (optional).

Manual: `/cal 내일 오후 3시 테스트 일정` ⇒ event in Google Calendar with 10-min popup; dashboard calendar shows it immediately; after the next hourly Apps Script run exactly one copy remains (check `calendar_events` count for that title = 1).

---

## 6. Slice 3 — A: Telegram natural-language updates

Step 1 (before any wiring): `scripts/jev-probe.mjs` — sends one fictional state with one `noul`, one `choice`, one `score` question; prints the response JSON (no token, no headers). **Done by the lead 2026-10-15 (live call)** — verified shapes, which supersede the guesses below:
- noul ⇒ `{type:'noul', noul: number}`
- choice ⇒ `{type:'choice', choice: string, confidence: number, probabilities: {[option]: number}}`
- score ⇒ `{type:'score', score: number, confidence: number, legend: {'0': label, …}, probabilities: {'0': number, …}}`; score `criteria` is sent as an **ordered array** of labels (index = score).
- `confidence` is systematically lower than the top probability ⇒ **never threshold on `confidence`**; decide on the top probability plus a margin over the runner-up.

Jev spec changes (apply throughout §6–§8):
- `JevQuestion` score variant: `{ type: 'score'; instructions: string; criteria: string[] }`.
- `JevAnswer` choice: `{ type: 'choice'; choice: string; top: number | null; margin: number | null; probabilities: Record<string, number> | null }` where `top = probabilities[choice] ?? max(probabilities)`, `margin = top − second-highest` (single option ⇒ margin = top). score: `{ type: 'score'; score: number; top: number | null; probabilities: Record<string, number> | null; legend: Record<string, string> | null }`. noul unchanged (`p = noul`).
- `decide()` and every other consumer accept a choice only when `top >= AX_THRESHOLD (0.6)` **and** `margin >= AX_MARGIN (0.2)`; otherwise the same fallback as low confidence. Tests: `{choice:'a', probabilities:{a:0.55,b:0.45}}` ⇒ low; `{a:0.7,b:0.25}` ⇒ ok; `{a:0.62,b:0.5}` ⇒ low (margin 0.12); missing probabilities ⇒ low.
- **Daily Jev budget** (owner: 200 calls/day): new `lib/ai/jev-budget.ts` — `export async function takeJevBudget(repo: MetaRepo, bucket: 'ax' | 'mail', today: string, limit: number): Promise<boolean>` (meta key `jev:count:<bucket>:<YYYY-MM-DD>`, increments **before** the call, returns false when `count >= limit`; old keys pruned via `deleteMeta` when > 7 days, best-effort). Bucket `ax` = A (free text), C (reply classification), D (weekly hints); limit `JEV_DAILY_LIMIT_AX = 200`. Budget exhausted in A ⇒ memo fallback with suffix `<i>(오늘 분류 한도 도달 — 메모로 저장했어요)</i>`; in C ⇒ reply alert without category; in D ⇒ no hints. Tests: 200th call true, 201st false; new day resets; repo throw ⇒ false (fail closed, memo).
- Reschedule guard (from review): `to < today` ⇒ `{ok:false, reason:'과거 날짜예요'}` (e.g. `10월 3일로 미뤄` on 10-15).
- Titles for calendar_event (A) **and `/cal` (B)** are `stripTokens(stripSpans(...))` so `@project #tag` never reaches Google Calendar.

Files: `lib/ai/jev.ts` (+test), `lib/logic/ax-candidates.ts` (+test), `lib/logic/ax-intent.ts` (+test), `lib/logic/ax-proposal.ts` (+test), `lib/ax/pending.ts`, `lib/ax/apply.ts` (+test with fake repo), `lib/telegram/ax.ts` (+test with fakes), `lib/telegram/client.ts` (markup/edit/answer), `lib/telegram/format.ts` (`parseTelegramUpdate`), webhook route, `scripts/telegram-setup.mjs` (`allowed_updates`), `.env.example` (`AI_GATEWAY_API_KEY`), CLAUDE.md.

```ts
// lib/ai/jev.ts — plain fetch, server-only, never throws, never logs state/token
export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> } // 1..255 options
  | { type: 'score'; instructions: string; criteria?: Record<string, string> };
export type JevAnswer =
  | { type: 'noul'; p: number }
  | { type: 'choice'; choice: string; p: number | null; probabilities: Record<string, number> | null }
  | { type: 'score'; score: number; probabilities: Record<string, number> | null };
export function jevToken(env?: NodeJS.ProcessEnv, headers?: Headers): string | null;       // P5 order
export function parseJevResponse(json: unknown, questions: Record<string, JevQuestion>): Record<string, JevAnswer> | null; // zod, tolerant; an answer whose type mismatches its question is dropped
export interface Jev { ask(state: string, questions: Record<string, JevQuestion>): Promise<Record<string, JevAnswer> | null> }
export function createJev(opts?: { token?: string | null; fetchImpl?: typeof fetch; timeoutMs?: number }): Jev | null; // null when no token; timeout 8000
// POST https://ai-gateway.vercel.sh/typesafe/v1/systemone {model:'typesafe-ai/jev', state, questions}
// choice p = probabilities?.[choice] ?? null

// lib/logic/ax-candidates.ts (pure)
export interface Candidate { key: string /* 't:<id>' | 'd:<id>' */; kind: 'task' | 'deadline'; id: string; title: string; projectName: string | null; dueDate: string | null }
export function prefilterCandidates(text: string, tasks: Task[], deadlines: Deadline[], projects: Project[], limit?: number /* 50 */): Candidate[];

// lib/logic/ax-intent.ts (pure)
export const INTENTS = ['memo','task_done','task_reschedule','deadline_done','deadline_reschedule','calendar_event','waiting_reply'] as const;
export type Intent = (typeof INTENTS)[number];
export const AX_THRESHOLD = 0.6;
export function axState(text: string, today: string): string;            // `메시지: "…"\n오늘: 2026-10-15 (목)`
export function axQuestions(candidates: Candidate[]): Record<string, JevQuestion>; // {intent} + {target} only if candidates.length>0 (options = keys + 'none')
export type Decision = { ok: true; intent: Intent; target: Candidate | null } | { ok: false; reason: 'low_intent' | 'low_target' | 'no_target' | 'kind_mismatch' | 'jev_error' };
export function decide(answers: Record<string, JevAnswer> | null, candidates: Candidate[], threshold?: number): Decision;
export function obviousMemo(text: string): boolean;                     // starts with '!' / '아이디어:' / '[ ]' / '메모:' or URL-only

// lib/logic/ax-proposal.ts (pure)
export type Proposal =
  | { kind: 'task_done'; taskId: string; title: string }
  | { kind: 'task_reschedule'; taskId: string; title: string; from: string | null; to: string }
  | { kind: 'deadline_done'; deadlineId: string; title: string }
  | { kind: 'deadline_reschedule'; deadlineId: string; title: string; from: string; to: string; dueTime?: string }
  | { kind: 'calendar_event'; events: NewEvent[] }
  | { kind: 'waiting_reply'; title: string; projectId: string | null; match: { from?: string; subject?: string }; nudgeAfterDays: number };
export type BuildResult = { ok: true; proposal: Proposal } | { ok: false; reason: string /* Korean, user-facing */ };
export function buildProposal(input: { text: string; today: string; nowTime: string; intent: Exclude<Intent, 'memo'>; target: Candidate | null; tasks: Task[]; deadlines: Deadline[]; projects: Project[]; papers: Paper[] }): BuildResult;
export function formatProposal(p: Proposal, today: string): string;      // HTML, escaped
export type PendingStatus = 'pending' | 'applied' | 'cancelled' | 'memo';
export interface PendingProposal { type: 'proposal'; id: string; createdAt: string; text: string; proposal: Proposal; status: PendingStatus; result?: string }
export const PENDING_PREFIX = 'telegram:pending:';
export function newShortId(rand?: () => number): string;                // 10 chars [0-9a-z]
export function isExpired(createdAt: string, now: string, ttlHours: number): boolean;
export type CallbackData = { t: 'p'; id: string; a: 'ok' | 'no' | 'memo' } | { t: 'w'; id: string; i: number; a: 'd' | 'p' | 'x' };
export function encodeCallback(c: CallbackData): string;                 // 'p:<id>:ok' | 'w:<id>:<i>:d'  (≤ 64 bytes)
export function decodeCallback(s: string): CallbackData | null;
export function proposalKeyboard(id: string): InlineKeyboard;            // [[적용, 취소], [메모로 저장]]
export function rememberUpdate(recent: number[], updateId: number, keep?: number /*50*/): { seen: boolean; next: number[] };
```

Rules:
- **Prefilter**: normalise (lowercase, strip spaces/punct); score = count of shared Hangul/alnum **character bigrams** between text and title (handles particles like 논문을/논문) + 3 if a project of the candidate is named in the text (slug/name/alias, `normalize` from capture.ts) ; only open items (task `status!=='done'`, deadline `!done`); drop score 0; sort score desc, then dueDate asc (null last), then title; cap `limit`.
- **One Jev request** per message: `jev.ask(axState(...), axQuestions(candidates))`. Intent criteria (Korean descriptions) per option; target criteria `"${title} · ${projectName ?? '프로젝트 없음'} · 마감 ${dueDate ?? '없음'}"`.
- **decide**: answers null ⇒ `jev_error`; intent `p == null || p < 0.6` ⇒ `low_intent`; intents needing a target (`task_*`, `deadline_*`): no candidates or target `'none'` ⇒ `no_target`; target p null/<0.6 ⇒ `low_target`; `task_*` with a `d:` key or vice versa ⇒ `kind_mismatch`. `calendar_event`/`waiting_reply` ignore target.
- **buildProposal**: `parseKoDateTime(text, today)`. Reschedule: `to = date ?? (shift ? applyShift(rescheduleBase(currentDue, today), shift) : null)`; null ⇒ `{ok:false, reason:'날짜를 찾지 못했어요'}`; `to === currentDue` ⇒ `{ok:false, reason:'이미 그 날짜예요'}`. Deadline reschedule includes `dueTime` only if `range?.start ?? times[0]` exists. calendar_event ⇒ `eventsFromParsed` + title from `stripSpans` (also strip `@`/`#` tokens via `stripTokens`), empty ⇒ fail. waiting_reply ⇒ title = stripped text; `match.from = extractEmailOrDomain(text)`; `match.subject` = paper shortName of the mentioned project (first paper with that projectId) else project name, only when a project is mentioned; `nudgeAfterDays = shift?.unit==='day' ? shift.n : 7`.
- **Flow** (`lib/telegram/ax.ts`, deps injected `{repo, jev, send, sendWithMarkup, edit, answer, calendarCfg, now}`):
  - `handleFreeText(text)`: `jev == null || obviousMemo(text)` ⇒ today's memo path, byte-identical reply. Else ask → decide → if `intent==='memo'` ⇒ memo, normal reply. If fail/low ⇒ memo + suffix (P21). `calendar_event` with `calendarCfg == null` ⇒ memo + `캘린더 연동 미설정 — 메모로 저장했어요`. buildProposal fail ⇒ memo + `(${reason} — 메모로 저장했어요)`. Else save `PendingProposal` (prune first: delete `telegram:pending:*` with `createdAt` > 7 days), `sendWithMarkup(formatProposal(p), proposalKeyboard(id))`.
  - `handleCallback(cb)`: `decodeCallback` null ⇒ answer `'알 수 없는 버튼'`. Load record; missing ⇒ answer `'만료됨'`. `status !== 'pending'` ⇒ answer `'이미 처리됨'`. Expired (24h) ⇒ answer `'만료됨'`, edit to text + `\n<i>만료됨</i>` without keyboard. Set status first (write), then: `ok` ⇒ `applyProposal`; `no` ⇒ nothing; `memo` ⇒ `createNoteFromText(record.text, null, 'telegram')`. Edit message to `formatProposal + '\n' + result` with keyboard removed. `revalidateAll()` after a successful apply (route layer).
- **applyProposal(repo, deps, p)** (`lib/ax/apply.ts`) returns Korean result string; target missing ⇒ `'대상을 찾을 수 없어요 (삭제됨?)'`; already done ⇒ `'이미 완료돼 있어요'`. task_done ⇒ `updateTask(id,{status:'done'})`; task_reschedule ⇒ `{dueDate: to}`; deadline_done ⇒ `{done:true}`; deadline_reschedule ⇒ `{dueDate: to, ...(dueTime ? {dueTime} : {})}`; calendar_event ⇒ `createCalendarEvents`; waiting_reply ⇒ `addWaitingItem` (Slice 4; until then this intent is not offered — `axQuestions` omits it behind a flag constant `WAITING_ENABLED`).
- **client.ts**: private `call(method, body)` applying config check + dev guard + 5 s timeout + no-throw; `sendMessage(text, opts?: {chatId?, replyMarkup?})` returns `SendResult & {messageId?: number}`; `editMessageText(messageId, text, replyMarkup?: InlineKeyboard | null)`; `answerCallbackQuery(id, text?)`. `type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }`.
- **format.ts**: `parseTelegramUpdate(u): {kind:'message'; updateId; chatId; text} | {kind:'callback'; updateId; chatId; callbackId; messageId; data} | null` (callback chat id = `callback_query.message.chat.id`); keep `parseUpdate` unchanged.
- **Webhook**: `maxDuration = 30`; parse via `parseTelegramUpdate`; wrong chat ⇒ silent 200; `rememberUpdate` on `telegram:updates:recent` ⇒ seen ⇒ 200 no-op; message ⇒ commands as today, capture ⇒ `handleFreeText`; callback ⇒ `handleCallback`. Jev created with `createJev({token: jevToken(process.env, request.headers)})`.

Tests:
- jev: `parseJevResponse({answers:{a:{type:'noul',noul:0.98}}}, {a:noulQ})` ⇒ `{a:{type:'noul',p:0.98}}`; choice `{type:'choice',choice:'x',probabilities:{x:0.7,y:0.3}}` ⇒ p 0.7; choice without probabilities ⇒ p null; garbage ⇒ null; `{message,error_type}` ⇒ null; `createJev({token:null})` ⇒ null; fetch 500 ⇒ `ask` resolves null; abort ⇒ null; request body has `model:'typesafe-ai/jev'` and header `Authorization: Bearer k`.
- `jevToken({AI_GATEWAY_API_KEY:'a',VERCEL_OIDC_TOKEN:'b'})` ⇒ `a`; `{VERCEL_OIDC_TOKEN:'b'}` ⇒ `b`; `{}` + header `x-vercel-oidc-token: c` ⇒ `c`; nothing ⇒ null.
- prefilter: text `논문 초안 끝냈어`, tasks `[논문 초안 작성 (open), 논문 초안 작성 (done), 장보기]` ⇒ one candidate, the open one; 60 matching tasks ⇒ 50; no overlap ⇒ `[]`; `@trading 리밸런싱` boosts that project's task over a same-overlap task elsewhere.
- decide: intent p 0.59 ⇒ `low_intent`; `task_done` p 0.9 + target `t:1` p 0.8 ⇒ ok; target `none` ⇒ `no_target`; target `d:1` for `task_done` ⇒ `kind_mismatch`; `calendar_event` 0.9 with no candidates ⇒ ok target null; null ⇒ `jev_error`.
- obviousMemo: `!앱 아이디어` true; `https://a.b/c` true; `내일 3시 치과` false.
- buildProposal (today 10-15, task due `2026-10-10`): `2주 미뤄` ⇒ to `2026-10-29` (base = today); due `2026-10-20` + `+3일` ⇒ `10-23`; `다음주 화요일로` ⇒ `10-20`; no date ⇒ fail `날짜를 찾지 못했어요`; deadline `금요일 5시로 미뤄` ⇒ to `10-16`, dueTime `17:00`; calendar `내일 2시 3시 미팅` ⇒ 2 events; `미팅` without date/time ⇒ fail.
- callback codec round-trip; `decodeCallback('p:abc:zz')` ⇒ null; encoded length ≤ 64.
- `rememberUpdate([1,2],2)` ⇒ seen true; `([…50 ids], 99)` ⇒ next length 50 ending in 99.
- `isExpired(t0, t0+24h+1ms, 24)` ⇒ true; at +23h ⇒ false.
- ax flow (fakes): jev null ⇒ memo created, reply equals `formatCaptureReply(note, …)` exactly; low intent ⇒ memo + suffix; proposal ⇒ pending saved, `sendWithMarkup` called, **no repo mutation**; callback `ok` ⇒ `updateTask` called once, record status `applied`, edit without keyboard; second `ok` ⇒ `이미 처리됨`, no second mutation; expired ⇒ no mutation; `memo` ⇒ note created with original text; seen update_id ⇒ nothing.
- apply: missing task ⇒ message, no throw; deadline reschedule without dueTime leaves dueTime untouched (patch has no key).

Manual: rerun `npm run telegram:setup` (P1). Send `논문 초안 끝냈어` (with such a task open) ⇒ proposal with buttons; 취소 ⇒ nothing changes; resend, 적용 ⇒ task done on dashboard. Send `ㅋㅋ` ⇒ memo with normal reply. Remove `AI_GATEWAY_API_KEY` in a preview ⇒ every text is a memo, reply unchanged.

---

## 7. Slice 4 — C: reply-waiting tracker

Files: `lib/logic/waiting.ts` (+test), `lib/waiting-data.ts`, `app/api/google/waiting/route.ts` (+`route.test.ts`), `app/api/google/sync/route.ts` (`waiting` key), `proxy.ts` (allow `/api/google/waiting`), `integrations/google/Code.gs`, `integrations/google/README.md`, webhook (`/waits`, `/wait`), `lib/telegram/format.ts` (`waits`,`wait` commands, list/alert/digest section), `lib/telegram/digest.ts` (load waiting), `lib/logic/ax-intent.ts` (`WAITING_ENABLED = true`), `scripts/telegram-setup.mjs`.

```ts
// lib/logic/waiting.ts (pure)
export const WAITING_META_KEY = 'waiting:replies';
export type ReplyCategory = 'approved' | 'declined' | 'question' | 'other';
export interface WaitingReply { messageId: string; from: string; subject: string; snippet: string; date: string /* ISO */; category?: ReplyCategory; positive?: number }
export interface WaitingItem {
  id: string;                 // 'w' + 6 [0-9a-z]
  title: string;
  projectId: string | null; taskId: string | null; deadlineId: string | null;
  match: { from?: string; subject?: string };
  since: string;              // 'YYYY-MM-DD' KST
  createdAt: string;          // ISO; replies must be at/after this instant (P16)
  nudgeAfterDays: number;     // default 7
  status: 'open' | 'replied' | 'closed';
  reply?: WaitingReply;
}
export interface WaitingMatchInput { id: string; matches: Array<{ messageId: string; from: string; subject: string; snippet: string; receivedAt: string }> }
export function newWaitingItem(p: Extract<Proposal, {kind:'waiting_reply'}>, today: string, now: string, id: string): WaitingItem;
export function waitingGmailQuery(item: WaitingItem): string | null;   // null if neither from nor subject
export function waitingQueries(items: WaitingItem[]): Array<{ id: string; query: string; after: string }>; // open + query != null, max 30
export function applyWaitingMatches(items: WaitingItem[], input: WaitingMatchInput[]): { items: WaitingItem[]; replied: Array<{ item: WaitingItem; reply: WaitingReply }> };
export function waitingNudges(items: WaitingItem[], today: string): Array<{ item: WaitingItem; days: number }>;
export function openWaitingList(items: WaitingItem[]): WaitingItem[];  // status open, sort since asc then createdAt
export function extractEmailOrDomain(text: string): string | null;
export type WaitCommand = { kind: 'list' } | { kind: 'edit'; target: string; patch: { from?: string; subject?: string; nudgeAfterDays?: number } } | { kind: 'close'; target: string } | { kind: 'invalid' };
export function parseWaitCommand(arg: string): WaitCommand;           // '/wait 2 from:a@b.com', '/wait w1a2b3 subject:"Revision"', '/wait 2 days:5', '/wait 2 close'
export function resolveWaitTarget(items: WaitingItem[], target: string): WaitingItem | null; // 1-based index into openWaitingList, or id
export function replyQuestions(): Record<string, JevQuestion>;        // {positive: noul, category: choice over ReplyCategory}
// lib/waiting-data.ts (server)
export async function loadWaiting(repo): Promise<WaitingItem[]>;
export async function saveWaiting(repo, items: WaitingItem[]): Promise<void>;
export async function addWaitingItem(repo, item: WaitingItem): Promise<void>; // re-read then append
```

Rules:
- Gmail query: `from:${from}` (an email or a domain), `subject:"${subject without quotes/parens}"`, `after:${since−1 day as YYYY/MM/DD}`, ` -in:sent -in:chats in:anywhere`.
- `applyWaitingMatches`: only items with `status==='open'`; candidate messages `receivedAt >= createdAt`; pick the **earliest**; set `status:'replied'`, `reply`; items not in input unchanged; unknown ids ignored; items already replied never re-alerted (dedupe = status + messageId).
- Sync route: `waiting: z.array(z.object({id: z.string().min(1).max(40), matches: z.array(z.object({messageId: z.string().min(1), from: z.string().max(300), subject: z.string().max(500), snippet: z.string().max(300), receivedAt: z.string().min(1)})).max(3)})).max(30).optional()`. After the existing work: re-read waiting, apply, save, then for each `replied`: Jev (`createJev`) on `"제목: …\n보낸이: …\n내용: snippet"` ⇒ `category`/`positive` (Jev null ⇒ omitted), save again, send one Telegram per reply: `📬 답장 도착: <title>\n분류: 승인|거절|질문|기타 (긍정 87%)\n<from> · <subject>\n<snippet ≤120>` (escaped). Missing key ⇒ no change.
- `GET /api/google/waiting` (bearer `GOOGLE_SYNC_TOKEN`, 503/401 like sync): `{ ok: true, items: waitingQueries(items) }`.
- Code.gs: `collectWaiting_(props)` — GET `/api/google/waiting`; non-200/parse error ⇒ return null (payload unchanged). For each item `GmailApp.search(item.query, 0, 5)`; from each thread, messages with `getDate() >= new Date(item.after)` and `getFrom()` not containing `Session.getActiveUser().getEmail()`; up to 3 per item: `{messageId, from, subject, snippet: getPlainBody() whitespace-collapsed slice(0,300), receivedAt: toISOString()}`. `payload.waiting = result` only when non-null. Log counts only.
- Telegram: `/waits` ⇒ numbered open list `1. 제목 · from:… · 12일째`; `/wait …` per `parseWaitCommand`; invalid ⇒ usage line. Digest: `DigestInput.waiting?: Array<{title: string; days: number}>`, section `<b>⏳ 답장 대기</b>` lines `• 제목 — 답장 없음 N일 — 재문의?`, counted as content in the empty check.
- waiting_reply proposal text shows `보낸이: (미지정 — /wait n from:주소 로 설정)` when no from; items with no from/subject are listed and nudged but never searched.

Tests:
- `waitingGmailQuery({match:{from:'editor@journal.org'}, since:'2026-10-15'})` ⇒ `from:editor@journal.org after:2026/10/14 -in:sent -in:chats in:anywhere`; subject `Re: "BrainCT" (rev)` ⇒ `subject:"Re: BrainCT rev"`; neither ⇒ null.
- `applyWaitingMatches`: match before createdAt ⇒ unchanged; two matches ⇒ earliest chosen; replied item + new input ⇒ no `replied` entry; closed item ignored.
- `waitingNudges` since `2026-10-08`, nudge 7, today `2026-10-15` ⇒ `[{days:7}]`; today `10-14` ⇒ `[]`; replied ⇒ `[]`.
- `extractEmailOrDomain('editor@journal.org 답장 기다림')` ⇒ email; `'mdpi.com 에서 답 오면'` ⇒ `mdpi.com`; `'https://x.com/a'` ⇒ null (URLs excluded); none ⇒ null.
- `parseWaitCommand('2 from:a@b.com')` ⇒ edit; `('w1a2b3 subject:"Major revision"')` ⇒ subject `Major revision`; `('2 days:5')` ⇒ 5; `('2 close')` ⇒ close; `('')` ⇒ list; `('x')` ⇒ invalid.
- `resolveWaitTarget(items,'1')` ⇒ oldest open; unknown ⇒ null.
- Route tests: waiting GET 503 without token, 401 wrong token, 200 shape; sync POST with `waiting` marks replied and sends one message (sender mocked); POST without `waiting` leaves meta untouched.
- formatDigest with only `waiting` ⇒ non-null and contains `답장 없음 7일`.

Rollout: deploy server first (old Code.gs keeps working), then paste the new `Code.gs` into **both** Apps Script projects (each account) and run `sync` once from the editor to authorise any new scope (none expected — GmailApp/UrlFetchApp already used). Rerun `npm run telegram:setup` for `/waits`, `/wait` menu entries.

Manual: send `editor@example.org 답장 기다림 @프로젝트` ⇒ proposal ⇒ 적용 ⇒ `/waits` lists it. Send a mail from another account matching `from:` ⇒ after next hourly sync one 📬 message; next sync no repeat.

---

## 8. Slice 5 — D: Sunday weekly review

Files: `lib/logic/weekly-review.ts` (+test), `lib/telegram/weekly.ts` (+test), `lib/project-checklist.ts` (factored core), `app/actions/project-checklist.ts` (calls core), `lib/logic/project-detail.ts` (snooze + `hiddenProjectItemKeys`), `lib/telegram/digest.ts` (`loadProjectDue(repo, today, overdueDays=7)` + use `hiddenProjectItemKeys`), `app/api/cron/evening/route.ts`, `lib/telegram/ax.ts` (handle `t:'w'` callbacks).

```ts
// project-detail.ts
export interface ResolvedProjectItem { state: 'done' | 'skip' | 'snooze'; at: string; noteId: string | null; until?: string }
export function hiddenProjectItemKeys(map: ResolvedProjectItems, today: string): Set<string>; // snooze hidden only while until > today

// lib/project-checklist.ts (server, no requireUser, no revalidate)
export async function resolveProjectItem(repo, input: { projectId: string; text: string; state: 'done' | 'skip' | 'snooze'; until?: string }, today: string, source: Note['source']): Promise<void>;
export async function unresolveProjectItem(repo, input: { projectId: string; text: string }): Promise<void>;

// lib/logic/weekly-review.ts (pure)
export type WeeklyItemRef = { kind: 'task'; id: string } | { kind: 'deadline'; id: string } | { kind: 'project'; projectId: string; text: string };
export interface WeeklyItem { ref: WeeklyItemRef; section: 'overdue' | 'stale' | 'project'; title: string; project: string | null; due: string | null; state: 'open' | 'done' | 'postponed' | 'dropped'; hint?: 'keep' | 'postpone' | 'drop' }
export interface WeeklyReview { items: WeeklyItem[]; more: number; clusters: Array<{ from: string; to: string; titles: string[] }> }
export const WEEKLY_MAX_ITEMS = 10;
export function buildWeeklyReview(input: { today: string; tasks: Task[]; deadlines: Deadline[]; projectDue: DueChecklist; projects: Project[] }): WeeklyReview;
export function deadlineClusters(deadlines: Deadline[], today: string, days?: number /*7*/): WeeklyReview['clusters'];
export function formatWeekly(r: WeeklyReview, today: string): string;
export function weeklyKeyboard(id: string, items: WeeklyItem[]): InlineKeyboard;   // one row per open item: [`${n} ✅`, `${n} +1주`, `${n} ✖`]
export interface PendingWeekly { type: 'weekly'; id: string; createdAt: string; today: string; review: WeeklyReview }
export function isSunday(today: string): boolean;                      // weekdayOf === 0

// lib/telegram/weekly.ts
export type WeeklyResult = 'sent' | 'skipped-empty' | 'skipped-already' | 'skipped-weekday' | 'failed';
export async function runWeekly(repo, sendWithMarkup, today: string, opts: { force: boolean; jev: Jev | null }): Promise<WeeklyResult>;
export async function applyWeeklyAction(repo, record: PendingWeekly, index: number, action: 'd' | 'p' | 'x', today: string): Promise<{ record: PendingWeekly; result: string }>;
```

Rules:
- Overdue: my tasks (`assignee!=='agent'`, not done, `dueDate < today`) + deadlines (`!done`, `dueDate < today`). Stale: my open tasks, not already overdue, `kstDate(updatedAt) <= today−14`. Project: `projectDue.overdue` loaded with `overdueDays = 30`. Priority order: overdue deadlines, overdue tasks, project, stale; within a section due asc then title. Keep first 10; `more` = rest.
- Clusters: open deadlines with `today <= due <= today+7`; sort by due; chain where consecutive dues differ by ≤ 1 day; keep chains with ≥ 2 deadlines. Informational only (no buttons).
- Empty (no items and no clusters) ⇒ no message, still record `telegram:weekly:lastSent = today`.
- Idempotency: `!force && lastSent === today` ⇒ skipped-already; `!force && !isSunday(today)` ⇒ skipped-weekday.
- Jev hint (optional): one request, one `choice` question per item (`q0..q9`, options keep/postpone/drop); `p >= 0.6` ⇒ `hint`; rendered as `⏩?` (postpone) / `🗑?` (drop) suffix; keep ⇒ nothing; Jev null ⇒ no hints.
- Actions (TTL 72h): `d` 완료 — task `status:'done'`, deadline `done:true`, project `resolveProjectItem(state:'done')`; `p` +1주 — task/deadline `dueDate = applyShift(rescheduleBase(due, today), {day,7})` (stale task with null due ⇒ today+7), project `state:'snooze', until: today+7` + memo; `x` 안 함 — task `status:'done'` + description `\n[안 함 YYYY-MM-DD]` (P9), deadline `done:true`, project `state:'skip'`. Item already non-open ⇒ answer `이미 처리됨`. After each action: edit message with `formatWeekly` (state marks ✅/⏩/✖ before the line) and `weeklyKeyboard` (rows only for open items; none left ⇒ keyboard removed).
- Evening route: after `runEvening`, `weekly = await runWeekly(..., { force: searchParams.has('weekly'), jev })`; response `{ok, evening, weekly}`. Separate messages; evening behaviour unchanged.

Tests:
- `isSunday('2026-10-18')` true, `('2026-10-15')` false.
- buildWeeklyReview (today `2026-10-18`): task due `10-10` open ⇒ overdue; task done ⇒ excluded; agent task overdue ⇒ excluded; task updated `2026-10-03T00:00:00Z` no due ⇒ stale; updated `2026-10-05` ⇒ not stale (13 days); overdue task is not also listed as stale; 12 items ⇒ 10 + `more: 2`; ordering deadline before task.
- deadlineClusters: dues `10-20`,`10-21`,`10-24` ⇒ one cluster `10-20..10-21`; `10-20`,`10-20` ⇒ cluster; `10-20`,`10-22` ⇒ none; `10-26` (beyond 7 days) ignored; done ignored.
- hiddenProjectItemKeys: `{k1:{state:'done'}, k2:{state:'snooze',until:'2026-10-20'}, k3:{state:'snooze',until:'2026-10-18'}}` today `10-18` ⇒ `{k1,k2}`.
- runWeekly (fakes): Thursday ⇒ skipped-weekday, no send; Sunday ⇒ sent, pending saved with type weekly, lastSent set; second run ⇒ skipped-already; force on Thursday ⇒ sent; empty ⇒ skipped-empty + lastSent set; sender fails ⇒ failed, lastSent not set.
- applyWeeklyAction: `p` on deadline due `10-10` (today `10-18`) ⇒ `10-25`; `x` on task ⇒ status done + description suffix; `d` on project ⇒ resolved map entry `done` + memo `sent`; repeat ⇒ `이미 처리됨`, no repo call.
- resolveProjectItemAction still passes existing behaviour (refactor-only test: same memo body and map entry).

Manual: `curl -H "Authorization: Bearer $CRON_SECRET" "$CLOUD_URL/api/cron/evening?weekly=1"` ⇒ weekly message with buttons; press `+1주` on an overdue deadline ⇒ due moves to today+7 on the dashboard, line shows ⏩, row disappears. Plain evening call on a weekday ⇒ `weekly: 'skipped-weekday'`.

---

## 8a. Slice 6 — new monthly shift-sheet alert

Goal: one Telegram message the first time a month's shifts (owner's row only) reach the server — "N월 근무표 나왔어요" + that month's summary. No change-diff alerts (owner gets those on KakaoTalk). Server-only; **no Code.gs change** (the existing `work` payload already carries `{from,to,shifts}` for every `YY.MM` tab containing the owner's row).

Facts: `saveWorkShifts` merges into `work:shifts` (`app/api/google/sync/route.ts`, `lib/logic/work.ts:32-47`); `parseShift` gives `kind: work|off|other`, `short` (`A1`), times (`lib/logic/work.ts:57-81`). Both Apps Script accounts may send `work` only if `WORK_SHEET_ID` is set in that account (normally one).

Files: `lib/logic/work-announce.ts` (+test), `app/api/google/sync/route.ts` (`saveWorkShifts` calls it), `lib/telegram/format.ts` (`formatShiftMonth`), `lib/google/calendar-write.ts` (optional off-day events), `.env.example`.

```ts
export const WORK_ANNOUNCED_META_KEY = 'work:announced';           // { months: string[] /* 'YYYY-MM' */, seededAt: string }
export const WORK_ANNOUNCE_MIN_DAYS = 20;                          // a half-filled tab is not "out" yet
export function monthsToAnnounce(incoming: WorkShift[], announced: string[] | null, today: string, minDays?: number): string[];
export interface ShiftMonthSummary { month: string; workDays: number; offDays: string[]; weekendWork: Array<{ date: string; short: string }>; byShort: Record<string, number>; other: Array<{ date: string; label: string }> }
export function summarizeShiftMonth(month: string, shifts: WorkShift[]): ShiftMonthSummary;
export function offDayEvents(summary: ShiftMonthSummary): NewEvent[]; // one per off day: { title: 'off', startTime: '08:30', endTime: '09:30' }
```

Rules:
- `monthsToAnnounce`: months (`date.slice(0,7)`) present in `incoming` with ≥ `minDays` shift rows, `month >= today.slice(0,7)` (never announce past months), not in `announced`. **`announced === null` (first run after deploy) ⇒ return `[]`**; the caller seeds `announced` with every month already in `work:shifts` ∪ incoming (no spam on rollout).
- Order in `saveWorkShifts`: compute months → merge/save shifts → for each month send the message → on send ok append the month to `announced` (failed send ⇒ retried next hourly sync). Dev guard applies (sendMessage).
- Message (`formatShiftMonth`): `<b>📋 11월 근무표 나왔어요</b>` / `근무 20일 · 휴무 10일` / `A1 6 · A2 5 · B1 5 · B2 4` / `휴무: 1(일) 2(월) 8(일) …` / `주말 근무: 11/7(토) A1, …` / `기타: 11/12 교육` (lines omitted when empty).
- Optional off-day calendar events (owner convention, decided 2026-10-15): env `WORK_OFF_EVENTS=1` enables, anything else/unset = off (**default off**). When enabled and `googleCalendarConfig()` non-null, create one **timed** event per off day titled exactly `off`, `08:30–09:30` KST (not all-day), via `createCalendarEvents` (slice-2 10-minute popup applies). Only for the newly announced month; never on later syncs (no diffing ⇒ shift swaps are not mirrored — documented). Skip an off day that already has an event titled `off` on that date in `listCalendarEvents` (owner may have created it by hand).

Tests:
- `monthsToAnnounce(shiftsFor('2026-11', 30 days), ['2026-10'], '2026-10-20')` ⇒ `['2026-11']`; with 12 days ⇒ `[]`; `announced` contains it ⇒ `[]`; month `2026-09` ⇒ `[]`; `announced null` ⇒ `[]`.
- `summarizeShiftMonth`: codes `A1` on Sat 2026-11-07 ⇒ in `weekendWork`; `off` ⇒ `offDays`; `교육` ⇒ `other`; counts per short.
- `offDayEvents(summary with offDays ['2026-11-01','2026-11-08'])` ⇒ two events `{title:'off', date, startTime:'08:30', endTime:'09:30'}`.
- Route with `WORK_OFF_EVENTS` unset ⇒ no calendar call; `=1` + config ⇒ one insert per off day, skipping a date that already has an `off` event; `=true` ⇒ off (only `1` enables).
- Route: first POST after deploy seeds and sends nothing; POST with a new month ⇒ one message, month recorded; same POST again ⇒ none; send failure ⇒ month not recorded.

Manual: in a preview with a fake LocalRepo seed, POST a `work` payload containing next month (≥ 20 days) ⇒ one message; repeat ⇒ nothing.

## 8b. Slice 7 — mail triage alerts (both Google accounts)

Goal: near-real-time Telegram alert for inbox mail that needs the owner's attention, for both accounts, PC off. Separate 5-minute Apps Script trigger; the hourly `sync` stays unchanged.

Privacy/quotas (constraints):
- **Owner update 2026-10-15:** both accounts (main and amc) send the ≤ 300-char body snippet — patient data lives in attachments only. Same treatment for both accounts. **Never** send attachments, attachment names, or attachment metadata: Code.gs must not call `getAttachments()`; the snippet comes from `getPlainBody()` only and is passed through `stripAttachmentNames_` (removes tokens matching `/\S+\.(pdf|hwpx?|docx?|xlsx?|pptx?|csv|zip|7z|dcm|jpe?g|png|tiff?)\b/gi`, e.g. a forwarded "첨부: x.pdf" line). The server re-applies the same pure filter (`stripAttachmentNames` in `lib/logic/mail-triage.ts`) before using the snippet.
- Per-account Script Property `TRIAGE_BODY` = `snippet` (**default**) | `none` (kill switch). Server-side kill switch `mail:triage:config.noBodyAccounts` (default `[]`) drops snippets for listed accounts.
- Nothing from mail is persisted server-side except message ids (dedupe) and counters; subject/sender/snippet only travel to Telegram.
- Apps Script consumer quotas: trigger runtime 90 min/day ⇒ 288 runs × ≤ 2 s ≈ 10 min/day. Each run: one `GmailApp.search` with `after:<epoch seconds>` (max 20 threads), **no UrlFetch when nothing is new**, `muteHttpExceptions`, no `getPlainBody()` when `TRIAGE_BODY=none`.

Files: `integrations/google/Code.gs` (`triage`, `setupTriage`, teardown covers both handlers), `integrations/google/README.md`, `app/api/google/mail-triage/route.ts` (+`route.test.ts`), `lib/logic/mail-triage.ts` (+test), `lib/ai/jev-budget.ts` (bucket `mail`), `lib/telegram/format.ts` (`formatMailAlert`), `proxy.ts` (allow `/api/google/mail-triage`), `.env.example` (`JEV_DAILY_LIMIT_MAIL` optional, default 300), docs/SETUP.md.

Code.gs:
```js
// Script Properties: TRIAGE_BODY ('snippet'|'none', default snippet), TRIAGE_QUERY (default 'in:inbox -category:promotions -category:social -category:forums'),
// TRIAGE_LAST (managed: epoch seconds of the newest message already sent)
function setupTriage()      // requireProps_(); installs everyMinutes(5) trigger for 'triage' (idempotent); runs triage() once
function triage()           // see rules
```
- `triage()`: `last = Number(TRIAGE_LAST) || now − 10 min`; `GmailApp.search(TRIAGE_QUERY + ' after:' + last, 0, 20)`; per thread, messages with `getDate() > last` and `getFrom()` not containing `Session.getActiveUser().getEmail()`; per message `{messageId, threadId, from, subject, receivedAt, link: 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(me) + '#all/' + threadId, snippet?}` (`snippet` unless `TRIAGE_BODY==='none'`: `stripAttachmentNames_(getPlainBody())` whitespace-collapsed, ≤ 300 chars; no attachment fields of any kind). None ⇒ return without fetch. Else POST `/api/google/mail-triage` `{account, messages}` (max 50); on HTTP 200 set `TRIAGE_LAST` = newest `getDate()` epoch; otherwise leave it (retry next run; server dedupes). First run: `TRIAGE_LAST` unset ⇒ only the last 10 minutes (never a backlog flood). Log counts and status only. Use `LockService.getScriptLock().tryLock(0)` to skip overlapping runs.
- `teardown()` deletes both `sync` and `triage` triggers.

Server:
```ts
// lib/logic/mail-triage.ts (pure)
export const MAIL_TRIAGE_CONFIG_KEY = 'mail:triage:config';   // { allow: string[]; deny: string[]; noBodyAccounts: string[] /* default [] */; threshold?: number }
export function stripAttachmentNames(text: string): string;      // same regex as Code.gs stripAttachmentNames_
export const mailSeenKey = (account: string) => `mail:triage:seen:${account}`; // string[] ring, last 1000 message ids
export interface TriageMail { messageId: string; threadId: string; from: string; subject: string; receivedAt: string; link: string; snippet?: string }
export function senderAddress(from: string): string;             // 'Name <a@b.com>' -> 'a@b.com' (lowercase)
export function matchesSender(address: string, patterns: string[]): boolean; // 'a@b.com' exact | '@b.com' / 'b.com' domain suffix (sub-domains included)
export type TriageDecision = 'deny' | 'allow' | 'ask';
export function triageDecision(m: TriageMail, cfg: TriageConfig): TriageDecision;   // deny wins over allow
export function unseen(mails: TriageMail[], seen: string[]): TriageMail[];
export function crossAccountKey(m: TriageMail): string;          // senderAddress + normalized subject (Fwd:/Re: stripped) — same letter in both accounts alerts once per KST day
export function triageState(m: TriageMail): string;              // '보낸이: …\n제목: …' (+ '\n내용: snippet' only if present)
export const ATTENTION_QUESTION: JevQuestion;                     // noul: "Does this email need the owner's attention right now (reply/action today), rather than later reading?"
```
- Route `POST /api/google/mail-triage` (bearer `GOOGLE_SYNC_TOKEN`, 503/401 like sync, 256 KB cap, zod: `account` as in sync, `messages` ≤ 50 with `from ≤ 300`, `subject ≤ 500`, `link` must start with `https://mail.google.com/`, `snippet ≤ 300` optional; the schema is `.strict()` per message so unexpected keys such as `attachments` are rejected with 400). Steps: drop snippets for `noBodyAccounts`, `stripAttachmentNames` on the rest → `unseen` vs `mailSeenKey(account)` → drop crossAccountKey already alerted today (`mail:triage:alerted:<YYYY-MM-DD>` string[]) → decision: `deny` ⇒ skip; `allow` ⇒ alert (no Jev); `ask` ⇒ `takeJevBudget(repo,'mail',today, limit 300)`; budget false ⇒ skip and send once per day `📧 메일 분류 한도 도달 — 허용 목록만 알림` (`mail:triage:capNotice` = date); else `jev.ask(triageState, {attention})`, `p >= threshold (0.7)` ⇒ alert; Jev null ⇒ skip. Record all processed ids in the seen ring (alerted or not). One Telegram message per run batching ≤ 5 alerts: `📧 <b>보낸이</b> · 제목\n<link>` (escaped; plus a ≤ 80-char first line of the filtered snippet when present, for either account). Response `{ok, processed, alerted}`.
- `integration:mail:<account>` meta `{at, detail: '처리 N · 알림 M'}` for the settings page.
- Allow/deny editing: app_meta only in this slice (edit via `/mailrule allow a@b.com` / `deny @x.com` / `list` Telegram command — optional sub-slice; settings UI later).

Tests:
- `senderAddress('Kim <A@B.com>')` ⇒ `a@b.com`; bare address ⇒ itself.
- `matchesSender('x@mail.b.com', ['b.com'])` true; `['@b.com']` true; `['c.com']` false; exact email.
- `triageDecision` deny+allow both match ⇒ `deny`.
- `unseen` drops seen ids; ring capped at 1000 (oldest dropped).
- `crossAccountKey('Fwd: Decision on X', from same)` equals the un-forwarded one.
- `triageState` omits `내용:` when no snippet.
- `stripAttachmentNames('첨부: 검사결과_홍길동.pdf 확인 부탁')` ⇒ `'첨부: 확인 부탁'`; `'see report.docx and scan.dcm'` ⇒ `'see and'`; plain text unchanged.
- Route: message with an `attachments` key ⇒ 400; account in `noBodyAccounts` with snippet ⇒ Jev state has no `내용:` line (assert on fake jev input); amc account (not listed) with snippet ⇒ `내용:` present, attachment names stripped; allow ⇒ alert without Jev call; deny ⇒ nothing; Jev p 0.69 ⇒ no alert, 0.71 ⇒ alert; budget exhausted ⇒ no Jev call, one cap notice per day; same message id twice ⇒ processed once; missing token ⇒ 503.
- Isolation gate: no account emails or names in code; tests use `example.org`.

Rollout: deploy → (no `TRIAGE_BODY` needed; default `snippet` on both accounts) → paste new Code.gs into **both** Apps Script projects → run `setupTriage` once in each (authorises nothing new: GmailApp/UrlFetchApp/LockService already in scope) → watch Apps Script executions for runtime < 2 s.

Manual: send a test mail from an allow-listed address to each account ⇒ alert within ≤ 5 min (both show a snippet line; a test mail with an attachment shows no file name); a newsletter ⇒ no alert; re-run `triage` manually ⇒ no duplicate.

## 9. Cross-cutting invariants (implementer must test)
1. **No mutation without a button press** (A, D): proposal/weekly creation paths call no `update*`/`create*` except `setMeta(pending)`.
2. **Byte-identical fallback**: with no Jev token, a free-text message yields exactly today's `formatCaptureReply` and one `createNote`.
3. **One request per message** to Jev; one per new reply (C); one per weekly run (D); one per `ask` mail (7). Every call goes through `takeJevBudget` (`ax` 200/day, `mail` 300/day); budget false ⇒ the documented fallback, never an error.
4. **Single reschedule rule**: `rescheduleBase(currentDue, today)` everywhere (A shift, D +1주).
5. **Optimistic calendar row is replaced, never duplicated**: same `account` as Apps Script, and a `replaceCalendarEvents` window covering it removes it.
6. **Idempotency keys**: `telegram:updates:recent` (update_id), pending `status`, `telegram:weekly:lastSent`, waiting `status`.
7. **Secrets never logged**; Telegram dev guard applies to every Bot API method (`call()`).
8. **check-isolation passes** (no personal emails/paths; tests use `example.org`).
9. **Backward compatibility**: old Code.gs + new server and new Code.gs + old server both work; `parseUpdate` and `resolveProjectItemAction` behaviour unchanged.

## 10. Rollout checklist
- B: Google Cloud setup (SETUP §10) → `scripts/google-oauth.mjs` → Vercel env `GOOGLE_OAUTH_*` (+ `GOOGLE_OAUTH_ACCOUNT`) → redeploy → `npm run telegram:setup` (`/cal`).
- A: Vercel env `AI_GATEWAY_API_KEY` → run `scripts/jev-probe.mjs` → deploy → `npm run telegram:setup` (**callback_query**).
- C: deploy → paste new `Code.gs` into **both** Apps Script projects → run `sync` once in each → `npm run telegram:setup` (`/waits`, `/wait`).
- D: deploy only (no new cron).
- E: edit `~/.claude/settings.json` on Windows **and** inside WSL.
- 6: deploy only (first sync seeds `work:announced`, sends nothing); optional `WORK_OFF_EVENTS=1` (timed `off` 08:30–09:30).
- 7: deploy → new Code.gs in **both** projects (snippet on by default for both) → `setupTriage` in each.
- CLAUDE.md phase-status line per slice; `.env.example` entries in the slice that reads them.

## 11. Review rubric (risk order, max 10)
1. Any path applies a task/deadline/calendar/waiting change without a callback press (grep `update*`/`create*` reachable from `handleFreeText`/`runWeekly`).
2. Telegram retry or double-tap creates duplicate proposals, double calendar events, or double applies (update_id ring, status-before-apply).
3. `allowed_updates` includes `callback_query`; callback chat id checked against `TELEGRAM_CHAT_ID`.
4. Optimistic calendar row id/account/calendarName: replaced by next sync (LocalRepo test), visible under default and explicit `calendar:visible`.
5. ko-datetime: every §3.2 row passes; no raw `Date` arithmetic outside dates.ts; meridiem/week/roll-over rules are single branches.
6. Jev failure modes (no token, 4xx/5xx, timeout, unknown shape, missing probabilities) all degrade to memo; no throw escapes the webhook; nothing logs `state`, tokens, or mail snippets.
7. `/api/google/waiting` allow-listed in `proxy.ts` and bearer-guarded (503/401); sync accepts payload with and without `waiting`.
8. Prompt hook: Node 18-compatible, exits ≤ 1.5 s silently on failure, no duplicates vs SessionStart, Stop hook ignores unmanaged markers.
9. Weekly: Sunday-only + once per day, +1주 base rule, project snooze un-hides after `until`, `resolveProjectItemAction` unchanged.
10. Dev guard covers `editMessageText`/`answerCallbackQuery`; isolation gate green; `.env.example`/SETUP/CLAUDE.md updated.
