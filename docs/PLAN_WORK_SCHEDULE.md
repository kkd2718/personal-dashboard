# PLAN — my clinic work shifts on the dashboard (from a shared Google Sheet)

Owner ask (2026-09-29): the clinic keeps the doctors' schedule in a private Google Sheet
("원장근무스케줄(2026.03~)"). The owner's Google account has read access. Show **only the owner's
own shifts** on the dashboard. Dashboard only: no Google Calendar writes.

## 0. Hard rules

- The sheet holds every doctor's name and schedule.
  - **Only the owner's row leaves the sheet.** The Apps Script reads the sheet, keeps the row
    whose name cell equals `WORK_NAME`, and sends just `{date, code}` pairs.
  - No names, and no other rows, go in the payload, in logs or in the DB.
  - `WORK_NAME` itself is never sent.
- The sheet ID and the name live only in Apps Script **Script Properties** (`WORK_SHEET_ID`,
  `WORK_NAME`).
  - Never put them in repo code, `.env.example` values, docs or tests. Use placeholders.
  - The check-isolation gate must still pass.
- Opt-in: when `WORK_SHEET_ID` is unset, the script behaves exactly as today and sends no
  `work` key. The server treats a missing `work` key as "no change".
- Nothing is written to Google Calendar.

## 1. Sheet layout (observed 2026-09-29)

One tab per month, named `YY.MM` (e.g. `26.10`). Each tab is a stack of week blocks:
```
,,,,10/5,10/6,10/7,10/8,10/9,10/10,10/11          <- date row: M/D cells above the weekday columns
10월 1째주,성별,근무일수,필러,월,화,수,목,금,토,일,근무일수 (총 /13층 /14층 ),비고   <- header row
<name>,남,5,O,B1,A1,A1,off,B2,off,A2,5 (3 / 2)      <- one row per doctor
...
```
- Weeks run Mon–Sun in the sheet. That doesn't matter: we key everything by date.
- Some cells in a row are empty (e.g. the 필러 column), so **read cells by column index**
  (`getDisplayValues()`), never by splitting text.
- Legend (right-hand columns of the tab):
  - `1조`: weekday 10:00–20:00, weekend 10:00–18:00
  - `2조`: weekday 10:30–20:30, weekend 10:30–18:30
  - `A` = 13층, `B` = 14층, so `A2` = 13층 2조.
- Cell values seen: `A1`, `A2`, `B1`, `B2`, `off`, and annotated forms like `A2(교환)`,
  `off(교환)`. Treat anything else as raw text (e.g. a leave note).

## 2. Apps Script — `integrations/google/Code.gs`

New optional Script Properties, documented in the header comment and `integrations/google/README.md`:
- `WORK_SHEET_ID`
- `WORK_NAME`
- `WORK_MONTHS_BACK`, default 1

`collectWorkShifts_()`:
- Opens the sheet with `SpreadsheetApp.openById`.
- Takes every tab whose name matches `/^(\d{2})\.(\d{1,2})$/`, keeping only months from
  (current month − WORK_MONTHS_BACK) onwards.
- For each tab:
  - Scan `getDisplayValues()` rows, remembering the most recent **date row**: a row where at
    least 5 cells match `/^\d{1,2}\/\d{1,2}$/`.
  - When a row's first cell (trimmed) equals `WORK_NAME`, map each column that holds a date in
    the remembered date row to that row's cell value in the same column.
- Year inference:
  - Start from the tab's `20YY`.
  - Tab month 12 with date month 1 gives year+1.
  - Tab month 1 with date month 12 gives year−1.
- Output `[{date:'YYYY-MM-DD', code:'<cell text trimmed, max 30 chars>'}]`.
  - Skip empty cells.
  - The same date seen in two tabs: the later tab wins.
- Wrap the whole thing in try/catch.
  - On any error, log `work: error <e.name>` (no values) and return `null`.
  - Return `null` also when the properties are unset.
- In `sync()`, when the result isn't null, add `work: { from, to, shifts }` to the payload:
  - `from` = first day of the earliest tab read;
  - `to` = last day of the latest tab read.
- Log `work=<count>` beside the other counts (the count only).

## 3. Server

**`app/api/google/sync/route.ts`**
- Schema: `work: z.object({ from: dateSchema, to: dateSchema, shifts: z.array(z.object({ date: dateSchema, code: z.string().min(1).max(30) })).max(500) }).optional()`.
- When present: `saveWorkShifts(repo, work)`.

**`lib/logic/work.ts`** (pure) + `work.test.ts`:
- `WORK_SHIFTS_META_KEY = 'work:shifts'`.
- `mergeShifts(existing, incoming)`: the stored value is `{ at, shifts: WorkShift[] }`.
  - Replace every stored shift whose date is within [incoming.from, incoming.to] with the
    incoming ones, and keep the others.
  - Drop anything older than 120 days.
  - Sort by date.
- `parseShift(code, date)` → `{ kind: 'work'|'off'|'other', floor?: '13층'|'14층', team?: 1|2, start?: 'HH:MM', end?: 'HH:MM', swapped: boolean, label: string }`.
  - Weekend means Saturday or Sunday (`dates.ts` helpers). Use weekend hours on weekends.
  - Examples:
    - `A1` on a weekday → `13층 1조 10:00–20:00`
    - `B2` on a Saturday → `14층 2조 10:30–18:30`
    - `off` → off
    - `A2(교환)` → A2 with `swapped: true`, label suffix ` (교환)`
    - unknown text → `other` with `label` = the text
- Tests cover every branch, including year-agnostic weekend detection and the merge window.

The route's `saveWorkShifts` reads the meta, merges, and writes. It goes through `getRepo()`
`getMeta`/`setMeta`.

## 4. UI

- **Calendar (`components/command-calendar.tsx`) and home week strip
  (`components/home/week-strip.tsx`)**: on work days only, show a compact shift row in the day
  cell, first row, as `💼 A1` (floor-team code) with the time on hover/title.
  - Off days show nothing, so the owner's manually entered Google "off" events keep showing
    as they do today.
  - `other` shows its label, truncated.
  - The calendar day popover gets a `근무` line (`13층 1조 10:00–20:00`, plus `(교환)` when
    swapped).
- Pages pass `workShifts` (from `repo.getMeta(WORK_SHIFTS_META_KEY)`) down:
  - `app/(main)/calendar/page.tsx`
  - `app/(main)/page.tsx` for the week strip
  - The props are optional and default to `[]`, so everything behaves as today when there is no
    data.
- **Telegram** (`lib/telegram/format.ts`): the daily digest and `/today` get a first line
  `💼 근무 13층 1조 10:00–20:00`, or `🌿 오늘 휴무` when today is `off`. Nothing when there is no
  data. Wire the data through whatever builds `input` for the digest and `/today`.
- **Settings 연동 상태**: if there is a Google integration status row, add `근무표 최근 동기화 <time> · N일`.
  Skip this if no such row exists.

## 5. Done when

- typecheck, test (new tests plus the existing ones) and build pass. Check the exit codes.
- `node scripts/check-isolation.mjs` passes, and no sheet ID or name appears anywhere in the repo.
- README documents the two properties and the privacy rule (only your row is sent).
- No commits. The main session deploys and pastes the script.
