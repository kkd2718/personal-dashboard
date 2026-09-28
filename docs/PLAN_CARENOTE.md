# PLAN — edit my CareNote procedure records from the dashboard calendar

Owner ask (2026-09-28): the hosted CareNote app (care-note-app.vercel.app, separate repo
`aesthetics-tracker`) already stores my procedure records. Instead of only linking out to it, the
dashboard calendar should let me **view, add, edit and delete** those records: which procedure,
and the per-procedure parameters.

CareNote shipped a token-authenticated JSON API for this (its milestone M24). The contract is
below and is fixed. Adapt to it, and flag any mismatch instead of guessing.

## 0. Hard rules

- The workspace token lives only in the server env var `CARENOTE_WS_TOKEN`. Optional
  `CARENOTE_API_BASE` defaults to `https://care-note-app.vercel.app/api/ws/v1`.
  - Never send the token to the browser. Never log it. Never put it in an error message.
- **Nothing from CareNote is persisted** on the dashboard side: no Supabase, no app_meta, no
  localStorage. Everything is fetched live through server actions and held in client state only.
- Feature flag: `careNoteEnabled = !!process.env.CARENOTE_WS_TOKEN`.
  - When false, no CareNote UI renders and the calendar behaves exactly as today.
  - All existing tests must keep passing with the env unset.
- The Repo adapter rule doesn't apply. CareNote is an external HTTP API, not our DB. The client
  lives in `lib/carenote/` and is `import 'server-only'`.
- Every server action calls `requireUser()` first, like the other actions.
- The throttle is 20 req/min per IP. Don't poll, and don't prefetch every month: fetch on
  calendar mount and on month change only. Cache `meta` in module scope on the server for 5 min.

## 1. API contract (from CareNote)

BASE `…/api/ws/v1`. Send `Authorization: Bearer <token>` and `cache: 'no-store'`.

Endpoints:
- `GET /meta` → `{ persons: Person[], procedureTypes: ProcedureType[] }`. Includes inactive
  entries (`active:false`).
- `GET /records?from=YYYY-MM-DD&to=YYYY-MM-DD[&personId=N]` → `{ records: RecordEntry[] }`.
  - Both ends inclusive, max 400 days.
  - Sorted by date, then id.
- `POST /records` → 201 `{ record }`.
- `PATCH /records/{id}` → 200 `{ record }`.
- `DELETE /records/{id}` → 204 with no body.

Errors come as `{ error: { code, message, fieldErrors? } }`. **Branch on `code`, never on
`message`.**

| status | code | handling |
|---|---|---|
| 400 | `validation` | `fieldErrors` is always present |
| 400 | `bad_request` | |
| 413 | `payload_too_large` | |
| 404 | `not_found` | also returned for a bad id format and for an unknown personId/procedureTypeId |
| 401 | `unauthorized` | token invalid |
| 429 | `rate_limited` | honour `Retry-After` (s) in the message, e.g. "잠시 후 다시 시도" |
| 500 | `internal` | also returned for a registry blip. **Not** a revoked token. |

Types (copy into `lib/carenote/types.ts`):
```ts
type CategoryKey = 'laser'|'lifting'|'booster'|'botox'|'filler'|'etc';
type FieldType = 'number'|'text'|'textarea'|'select'|'multiselect'|'region_units'|'checkbox';
interface ParamField { key; label; type: FieldType; unit?; required?; step?; min?; max?;
  options?: string[]; allowCustom?: boolean; regions?: string[]; placeholder?; help? }
interface ParamSchema { version: 1; fields: ParamField[] }
type ParamValue = string | number | boolean | string[] | Record<string, number>;
interface Person { id; name; color; relation: string|null; birthYear: number|null; memo: string|null;
  sortOrder; active; createdAt }
interface ProcedureType { id; name; category: CategoryKey; paramSchema: ParamSchema;
  intervalMinDays; intervalMaxDays; seriesDefaultCount: number|null; seriesRestDays; sessionGraceDays;
  note; sortOrder; active; createdAt; updatedAt }
interface CareRecord { id; personId; procedureTypeId; date: string; params: Record<string, ParamValue>;
  seriesIndex: number|null; seriesTotal: number|null; cost: number|null; note: string|null;
  createdAt; updatedAt }
```

POST input:
- Required:
  - `personId`
  - `procedureTypeId`
  - `date`
  - `params`: an object, `{}` if empty. Keys outside the schema are rejected.
- Optional, nullable:
  - `seriesIndex` and `seriesTotal`: 1–99. When both are set, index ≤ total.
  - `cost`: int 0–100,000,000
  - `note`: ≤ 2000 chars

PATCH input:
- Partial: only the fields sent change.
- When changing the series, always send `seriesIndex` and `seriesTotal` together.

Param value shapes by field type:
- `number` → number
- `text` / `textarea` / `select` → string
- `multiselect` → string[]
- `region_units` → `{ [region]: number }`
- `checkbox` → boolean

Omit empty values rather than sending `''` or `NaN`. For detailed validation, rely on the 400
`fieldErrors` and show them next to the fields. Keys look like `params.<key>`, `seriesIndex`,
etc. Show them as returned.

Series suggestion (client-side, optional nicety):
- When the procedure type has `seriesDefaultCount`, prefill `seriesTotal` with it.
- Prefill `seriesIndex` with the previous record's index + 1, using the same person and type,
  with index 1 after a completed series. Look only at records already loaded.

## 2. Files

### `lib/carenote/types.ts`
The types above, plus `CareApiError = { code: string; message: string; fieldErrors?: Record<string,string>; status: number }`.

### `lib/carenote/client.ts` (`import 'server-only'`)

Functions:
- `careNoteConfigured(): boolean`
- `getCareMeta(): Promise<{persons, procedureTypes}>`, with the 5-minute module cache
- `listCareRecords(from, to): Promise<CareRecord[]>`
- `createCareRecord(input)`, `updateCareRecord(id, patch)`, `deleteCareRecord(id)`

Behaviour:
- One internal `request(method, path, body?)` that:
  - adds the headers;
  - sets a 10 s timeout (`AbortSignal.timeout`);
  - parses the error body into `CareApiError`;
  - maps network failure or timeout to `{code:'unreachable', status:0}`.
- The client throws a typed `CareNoteError`.
- Pure helpers go in `lib/logic/carenote.ts`, not here, so they can be tested.

### `lib/logic/carenote.ts` + `carenote.test.ts` (pure, framework-free)

- `cleanParams(schema, values)` → drops `undefined`, `''`, `NaN`, empty arrays and empty
  region maps, and drops keys not in the schema.
- `suggestSeries(type, records, personId, date)` → `{ seriesIndex, seriesTotal } | null`
  (see §1).
- `recordSummary(type, record)` → a one-line Korean summary for list rows. Rules:
  - procedure name, then up to 3 non-empty params as `label value unit`;
  - region_units rendered as `부위 n` pairs;
  - a multiselect joined with `·`;
  - checkbox shows its label only when true;
  - then `n/m회` when series fields are set.
  - Example: `피코토닝 · 샷 1200 · 2/5회`.
- `recordsByDate(records)` → `Map<string, CareRecord[]>`.
- `careErrorMessage(err)` → the Korean user message per code:
  - unauthorized: "케어노트 토큰이 유효하지 않아요 (링크 재발급 여부 확인)"
  - rate_limited: "요청이 많아요. 잠시 후 다시 시도하세요"
  - unreachable / internal: "케어노트에 연결할 수 없어요"
  - not_found: the server message
  - validation: "입력값을 확인하세요"
- Tests cover every branch of these helpers.

### `app/actions/carenote.ts` (`'use server'`)

All actions return `{ ok: true, data } | { ok: false, error: string, code: string, fieldErrors?: Record<string,string> }`.
They never throw to the client, and each one calls `requireUser()` first.

- `loadCareMonthAction(from: string, to: string)` → `{ persons, procedureTypes, records }`.
  - zod-validate the dates.
  - Clamp: `to - from` ≤ 62 days.
- `createCareRecordAction(input)`, `updateCareRecordAction(id, patch)`, `deleteCareRecordAction(id)`.
  - zod-validate the envelope (types and ranges from §1). Params stay a loose object; CareNote
    validates them.
- No `revalidatePath`: nothing dashboard-side changes. The client updates its own state.

### UI

**`components/carenote/care-param-form.tsx`**: a controlled form built from `ParamSchema`.
- Port the behaviour of CareNote's `components/params/*`, read from
  `C:\Users\기덕\Desktop\Work\aesthetics\aesthetics-tracker\components\params\`: ParamForm,
  NumberField, TextField, TextareaField, SelectField (with `allowCustom` → free-text option),
  MultiSelectField, RegionUnitsField, CheckboxField.
- Restyle it with this repo's Tailwind tokens.
- Do not import anything across repos.
- Show `fieldErrors['params.<key>']` under each field.

**`components/carenote/care-record-editor.tsx`**: add or edit one record.
- Fields:
  - person select (active persons; hidden when there is exactly one);
  - procedure select, grouped by category in Korean (레이저, 리프팅, 부스터, 보톡스, 필러, 기타),
    listing active types plus the current record's type even when inactive;
  - date, defaulting to the day;
  - `CareParamForm`;
  - collapsible 추가 정보: 회차 index/total, cost (원), note.
- Changing the procedure resets params to `{}` and reapplies `suggestSeries`.
- Buttons: 저장, 취소, and 삭제 (edit mode only, with confirm "이 기록을 삭제할까요?").
- Submit sends `cleanParams(...)` output.
- On a validation error, keep the form open and show the field errors plus the top message.

**`components/carenote/care-day-section.tsx`**: goes in `DayPopover`.
- Heading `시술` with a small `ExternalLink` to `https://care-note-app.vercel.app/calendar`.
  Use the base URL without the token: the owner's browser already has the cookie.
- Lists that day's records as `recordSummary` rows, with a person colour dot when there is more
  than one person. Clicking a row opens `CareRecordEditor` inline in edit mode.
- A `+ 시술 기록` button opens the editor in create mode.
- Loading, error and empty states are compact, one line each.

**`components/command-calendar.tsx`**
- New optional prop `careNoteEnabled?: boolean`, default false.
- When enabled, fetch with `loadCareMonthAction` for the visible range:
  - month view: the grid's first to last day;
  - week view: that week;
  - on mount and whenever the range changes.
  - Keep results in state. Ignore stale responses by tracking a request id.
- Day cells: days with records get a small marker (a `Syringe` or `Sparkles` lucide icon, or a
  dot in the person colour).
  - It must not crowd the existing points.
  - In compact mode, a dot only.
- `DayPopover` gets `care` props (records for the day, persons, types, plus
  `onChanged(updatedRecords)`) and renders `CareDaySection` above the 메모/할 일/마감 tabs.
  - After create, update or delete, update the month state in place. Don't `router.refresh()`
    for CareNote changes.

**`app/(main)/calendar/page.tsx`**: pass `careNoteEnabled={careNoteConfigured()}`. Check any
other CommandCalendar usage and pass the flag there too.

## 3. Out of scope

- Persons and procedure types stay read-only (manage them in CareNote).
- No Telegram or digest integration.
- No stats.

## 4. Done when

- `npm run typecheck`, `npm test` (new logic tests included) and `npm run build` all pass. Check
  exit codes.
- Grep checks:
  - `CARENOTE_WS_TOKEN` appears only in `lib/carenote/client.ts` and `.env.example`;
  - no `lib/carenote/client` import from any `'use client'` file.
- `.env.example` documents `CARENOTE_WS_TOKEN` (Korean comment: the token part of the CareNote
  workspace link `/w/<token>`; revoked when the link is reissued) and `CARENOTE_API_BASE`.
- CLAUDE.md gets a short "CareNote" bullet under Machine APIs / Post-3 polish.
- No commits. The main session verifies against the live API and deploys.

---

# Addendum A (2026-09-28): make existing history visible

Owner feedback after the first release: "시술 해왔던 기록이랑 같이 보고 편집하려고 한 건데". The
data already loads (verified in prod: 31 records for a 6-week range), but two things make it look
as if only new records exist:
- the day marker is a faint 9px icon;
- there is no place to browse past records.

## A1. Calendar cells show the records themselves

In `components/command-calendar.tsx` (non-compact):
- Render each record like the other points: a small row, `truncate`, the person-colour dot
  (inline style, as already done), and the procedure name.
  - Share the existing 3-row point cap: care rows come first, then the other points, then
    `+N`.
  - Map type ids to names through `careTypes`.
- Week view gets the same rows.
- Compact mode keeps a dot.
- Remove the faint `Syringe` marker.

## A2. History panel on the CareNote project page

Follow the trading pattern in `app/(main)/projects/[slug]/page.tsx`: when
`project.id === CARENOTE_PROJECT_ID` (`'p-carenote'`, exported from `lib/logic/carenote.ts`)
and `careNoteConfigured()`, render `<CareHistoryPanel />` near the top, above the status card.

`components/carenote/care-history-panel.tsx` (client):
- Load with a new server action `loadCareHistoryAction()`:
  - fetches `/records` for today−339 … today+60 (a single call, exactly the 400-day limit)
    plus meta;
  - allow this range as its own action; keep `loadCareMonthAction`'s 62-day clamp unchanged.
- Header:
  - `시술 기록` plus a count;
  - person filter chips (hidden when there is one active person);
  - procedure filter (select with 전체, then the types that actually appear);
  - the `+ 시술 기록` button.
- **Recent-first list** grouped by month (`2026년 9월`). Each row shows:
  - the date (`9/14 (일)`);
  - the person dot;
  - `recordSummary`;
  - cost when set.
  - Clicking a row expands `CareRecordEditor` inline in edit mode; `+` opens it in create
    mode with today's date.
  - After save or delete, update local state.
- **Per-procedure summary** strip above the list (pure helper
  `procedureStats(records, types, today)` in `lib/logic/carenote.ts`, with tests).
  - For each (person, type) pair seen, show the type name, the last date, the count in range,
    and the next due window when `intervalMinDays`/`intervalMaxDays` are set: `다음 10/12~10/26`.
    - Mark it `지남` when today > last + max.
    - Mark it `가능` when today is within [last+min, last+max].
  - Sort: overdue first, then by next-window start.
  - Show at most 8, with a `더보기` toggle.
- States:
  - loading skeleton, 2–3 lines;
  - the `careErrorMessage` error line with a 다시 시도 button;
  - empty.
- Mobile-safe: `min-w-0`, `truncate`, the list inside the page flow (no nested scroll).
- The CareNote link row in the project's links stays as it is.

## A3. Tests / done when

- `procedureStats` unit tests: no interval, within window, overdue, multiple persons.
- `loadCareHistoryAction` range: today−339 … today+60 via `addDaysStr`/`todayKST` (KST).
- typecheck, test, build pass. No commits.

---

# Addendum B (2026-09-29): CareNote-style month calendar on the project page

Owner: the CareNote project page should **show the CareNote calendar itself**, so the Command
Center is the only place they need to look. The first release changed the project link instead,
and that was wrong. The link is restored to the CareNote app root and is not part of this plan.

## B1. `CareHistoryPanel` gets a view toggle: `캘린더` (default) | `목록`

- The header, person chips, procedure filter, `+ 시술 기록` and the per-procedure stats strip
  stay shared above both views. Both views respect the filters.
- `목록` is the existing month-grouped list, unchanged.
- `캘린더` is a new `components/carenote/care-month-calendar.tsx`. Mirror CareNote's own calendar,
  reading `aesthetics-tracker/components/calendar/{MonthGrid,DayCell,RecordChip,DayPanel}.tsx`
  for reference only (read-only, never import across repos):
  - Month navigation:
    - `‹ 2026년 9월 ›` plus a `오늘` button;
    - weeks start Monday;
    - holidays and today styled like the dashboard calendar. Reuse the existing helpers in
      `lib/logic/calendar.ts` / `dates.ts`; no new date math.
  - Day cells, each at least 96px tall on desktop:
    - up to 3 **record chips** with a person-colour left border or dot and the procedure name
      (`truncate`), then `+N`;
    - out-of-month days dimmed.
  - Clicking a day selects it and shows a **day panel** below the grid (not a popover), which
    reuses `CareDaySection` for that date. The panel lists the records, edits inline and adds a
    record with that date.
  - Mobile (<640px): cells shrink to dots in person colours, max 4, with the day number. Tapping
    opens the same day panel. No horizontal scroll.
- Data:
  - Months inside the already-loaded history range (today−339 … today+60) use the loaded
    records.
  - Navigating outside that range fetches the month grid range with `loadCareMonthAction` and
    merges by id into panel state, so edits stay consistent across views.
  - Show a small loading line while fetching.
- After create, update or delete, both views update from the same state. A record whose date
  changed moves to its new cell.

## B2. Done when

- Pure helpers the grid needs go in `lib/logic/carenote.ts` with tests: chips for a day after
  filtering, and "is month inside loaded range". Reuse the calendar week builders where they
  exist.
- typecheck, test, build pass. No commits.
