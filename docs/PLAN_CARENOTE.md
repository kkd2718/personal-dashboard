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
