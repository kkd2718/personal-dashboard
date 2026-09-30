# PLAN — daily routines (morning + evening Telegram, checkable on the dashboard)

Owner ask (2026-09-30): from 2026-10-01 they will do two daily study routines:
- 알렌의 서재 "오늘의 문제"
- 암기(Amgi) "오늘의 공부"

They want a Telegram message in the **morning and the evening**, and the routines should appear
in the **daily checklist** so they can be ticked.

## 1. Data (app_meta via `getRepo()`, no migration)

- `routine:items` holds `RoutineItem[]`, where
  `RoutineItem = { id: string; label: string; url: string | null; startDate: string; endDate: string | null; sort: number }`.
  - Seed it on first read when the meta is missing, with the two routines above:
    - `{ id: 'allen-daily', label: '알렌의 서재 오늘의 문제', url: null, startDate: '2026-10-01', endDate: null, sort: 0 }`
    - `{ id: 'amgi-daily', label: '암기 오늘의 공부', url: null, startDate: '2026-10-01', endDate: null, sort: 1 }`
  - The seed is ordinary data, not personal info.
- `routine:done:<YYYY-MM-DD>` holds `string[]`, the routine ids done that KST day.
- Pure logic in `lib/logic/routines.ts` + `routines.test.ts`:
  - `activeRoutines(items, date)`: startDate ≤ date and (endDate null or ≥ date), sorted.
  - `routineStatus(items, doneIds, date)` → `{ item, done }[]`.
  - `matchRoutine(items, query)`: for the Telegram `/done` command, matches a 1-based index or
    a case-insensitive substring of the label (`알렌`, `암기`). Returns null when ambiguous or
    not found.
  - `routineStreak(doneByDate, id, today)`: consecutive days up to today (or up to yesterday when
    today isn't done yet). Optional but cheap; show it as `🔥3`.

## 2. Server actions — `app/actions/routines.ts`

Each action does `requireUser()`, zod, then `revalidateAll`.
- `toggleRoutineAction(id, date, done)`.
- `saveRoutinesAction(items)`, used by settings.
  - Validation: label 1–60 chars, url is empty or `https?://`, dates as `YYYY-MM-DD`,
    at most 10 items.

## 3. UI

- **Home checklist lane** (`components/checklist-panel.tsx`, or a small `RoutineStrip` right above
  it in the 할 일 lane): a `오늘 루틴` block.
  - Show it only when there are active routines today.
  - Each routine is a checkbox with the label. The label links to `url` in a new tab when set.
    Show the streak when > 1.
  - Toggling is optimistic, then calls `toggleRoutineAction`.
- **Calendar day popover**: optional and skippable. Don't add routines to calendar cells.
- **Settings** (`app/(main)/settings/page.tsx`): a `루틴` section.
  - A list with label, URL, start date and end date, plus add, delete and reorder (up/down is
    fine).
  - Saving calls `saveRoutinesAction`.

## 4. Telegram

- **Morning digest** (`lib/telegram/digest.ts` + `format.ts`): a `🔁 오늘 루틴` section right after
  the header block. Lines look like `• 알렌의 서재 오늘의 문제`.
  - When `url` is set, make the label an HTML link: `<a href="url">label</a>`, with both escaped.
  - Active routines count as content, so the digest is sent on routine days even when nothing
    else is due.
- **`/today`** (webhook): the same section, showing each routine as ✅ or ⬜.
- **Evening reminder**: a new route `app/api/cron/evening/route.ts`.
  - Auth: `CRON_SECRET` bearer, the same way `app/api/cron/daily` does it (reuse its helper).
  - Once per KST day (meta `telegram:evening:lastSent`); `?force=1` bypasses that.
  - Content: `🌙 저녁 체크` plus the **not yet done** routines (with links) and a hint
    `완료하면 /done 1 처럼 보내세요`.
  - When every active routine is done, send nothing and still record lastSent.
  - When there are no active routines, send nothing.
  - Extract the logic into `lib/telegram/evening.ts` with a fake-repo test, like digest.test.ts.
  - `next dev` never sends, the same as the digest (`TELEGRAM_DEV_SEND=1` rule).
- **`vercel.json`**: add `{ "path": "/api/cron/evening", "schedule": "0 12 * * *" }`. That is
  21:00–21:59 KST (Hobby fires somewhere within the hour).
- **`/done <n|이름>` command** (webhook `route()` + handler): marks today's matching routine as
  done.
  - Replies `✅ 알렌의 서재 오늘의 문제 완료 (🔥3)`.
  - If ambiguous or not found, replies with the numbered list.
  - `/done` with no argument lists the numbered status.
  - Add `done` to `COMMAND_NAMES` and to the `/help` text.
  - If `scripts/telegram-setup.mjs` registers bot commands, add `done` there as well.

## 5. Done when

- Tests pass: routines logic; evening runner (sends only the remaining items, skips when all are
  done, once per day); digest includes routines; `/done` matching.
- typecheck, test, build and `node scripts/check-isolation.mjs` all pass.
- CLAUDE.md gets one Post-3 bullet for routines.
- No commits. The main session deploys and runs `scripts/telegram-setup.mjs` if the commands
  changed.
