# Phase 3 — Google Calendar, Gmail review deadlines, Obsidian inbox (2026-09-26)

Baseline: 45698b7 (GitHub auto-deploys `main`). Spec overrides earlier docs where different.
Principle (docs/reviews/plan-advice.md §7, §9): **no OAuth client in the app**. One Google Apps Script
per Google account pushes data to the app; Obsidian is **one-way** (vault → notes) via the PC collector.

Facts checked by the planner (don't re-investigate):
- The user has several calendars (primary personal, a second personal Gmail, Korean holidays, a
  clinic-scheduling calendar, a lab-shared calendar, a meeting-room calendar, a professor's calendar).
- The main Gmail has **no real reviewer invitations** in the last year — only look-alikes: publisher
  "call for reviewers" campaigns (MICCAI), "invite you to contribute an Article/Review" solicitations
  (MDPI, Springer collections), ClinicalKey issue alerts, co-author "Manuscript Received" notices
  (ScholarOne `onbehalfof@manuscriptcentral.com`). Real invitations probably arrive at another account,
  so the script must be installable in **multiple** accounts, each tagged with an `account` label.
- Obsidian vault: path from env `OBSIDIAN_VAULT` (local `.env.local` only — never hardcode). It is
  auto-committed by the obsidian-git plugin. Folder convention: `00_memo/` holds active memos.

## 1. Data model — migration `0004_phase3.sql` (+ types, mappers, LocalRepo, SupabaseRepo, tests)
- `calendar_events`: `id text pk` (`<account>:<calendarId>:<eventId>`), `account text`, `calendar_name text`,
  `title text`, `start_date text` (YYYY-MM-DD KST), `end_date text` (inclusive, KST), `start_time text null`
  ('HH:mm' KST; null = all-day), `end_time text null`, `location text null`, `updated_at timestamptz`.
  Domain `CalendarEvent`. Repo: `listCalendarEvents(from, to)`, `replaceCalendarEvents(account, from, to, events)`
  (delete that account's events overlapping [from,to], insert new — Postgres function `replace_calendar_events`
  via rpc for atomicity; LocalRepo under its mutex).
- `review_candidates`: `id text pk` (`rc-<gmail messageId>`), `account text`, `message_id text unique`,
  `received_at timestamptz`, `from_addr text`, `subject text`, `snippet text` (≤300 chars),
  `kind text` (`invitation|reminder|confirmation|other`), `journal text null`, `manuscript_id text null`,
  `title text null`, `due_date text null`, `link text null`, `status text` (`pending|accepted|dismissed`),
  `review_id text null` (set on accept), `created_at`, `updated_at`. Domain `ReviewCandidate`.
  Repo: `listReviewCandidates(status?)`, `upsertReviewCandidates(list)` → returns only **newly inserted**
  (existing message_id rows untouched — never resurrect a dismissed one), `updateReviewCandidate(id, patch)`.
- `notes.external_id text null unique` (+ `Note.externalId: string | null`). `createNote` with an
  existing externalId returns the existing note instead of inserting (idempotent imports).
- RLS on / revoke anon+authenticated for new tables, same as 0001.

## 2. Review-mail parser — `lib/logic/review-mail.ts` (pure, heavily tested)
`parseReviewMail({ from, subject, body, receivedAt }) → ParsedReviewMail | null`
- Return **null** (not stored) for non-assignments: calls for reviewers / "apply to review", invitations
  to *submit/contribute* an article or review, special-issue/collection solicitations, issue alerts,
  newsletters, "manuscript received/submitted" acknowledgements, decisions on the user's own papers.
- kinds: `invitation` ("invitation to review", "invited to review", "would you be willing to review",
  "agree to review", 심사 요청/의뢰), `reminder` ("review is due", "overdue", "reminder … review",
  "your review … by"), `confirmation` ("thank you for agreeing to review", "accepted the invitation").
  Anything reviewer-related but ambiguous → `other` (stored, shown for confirmation).
- Extract: `manuscriptId` (ScholarOne-style `ABC-2026-1234`, `ABC-D-26-00123`, `JMIR #12345`, `manuscripts-12345`
  (MDPI)); `journal` (subject brackets `[Journal]`, "for <Journal>", "Editor of the <Journal>", sender
  display name); `title` (quoted "…" or "entitled …"/"titled …"); `dueDate`: first date after
  due/by/deadline/within phrases — formats `15-Oct-2026`, `Oct 15, 2026`, `15 October 2026`, `2026-10-15`,
  `10/15/2026` (US order), `2026년 10월 15일`; relative "within 14 days" / "in 10 days" → receivedAt(KST)+n;
  `link`: first https URL containing reviewer/review/manuscript/assignment.
- Fixtures: write ≥14 realistic but **fictional** emails (fictional journals/people/ids) covering every
  kind, every date format, and every negative class above (model negatives on the look-alikes listed in
  "facts"). Tests assert kind/fields/null.

## 3. Sync API — `POST /api/google/sync` (bearer `GOOGLE_SYNC_TOKEN`, new; add to proxy public paths,
`.env.example`, Vercel env via CLI at deploy time)
Body (zod, cap 1 MB):
```
{ account: string (1..40, [A-Za-z0-9._@-]),
  calendar?: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', events: [{ calendarId, calendarName, eventId, title,
               start: ISO, end: ISO, allDay: boolean, location?: string|null }] (≤2000) },
  mails?: [{ messageId, threadId, receivedAt: ISO, from, subject, body (≤4000 chars) }] (≤200) }
```
- Calendar: convert to KST dates/times server-side (all-day end is exclusive in Google → inclusive
  end_date = end−1 day), `replaceCalendarEvents(account, from, to, …)`.
- Mails: `parseReviewMail` each; non-null → candidate (snippet = first 300 chars of body, whitespace-collapsed;
  **body itself is never stored**). `upsertReviewCandidates`; for newly inserted ones, Telegram
  `📨 리뷰 메일 감지: <journal> <manuscriptId> · 마감 <MM-DD|미상>` + dashboard link (one message per sync, ≤5 lines).
- Response `{ ok, events: n, candidates: { new, total } }`.
- Pure part (payload → events/candidates) in `lib/google/sync.ts`, unit-tested (timezone edges: all-day,
  multi-day, events crossing midnight KST, UTC→KST date shift).

## 4. Apps Script — `integrations/google/Code.gs` + `integrations/google/README.md` (Korean, step-by-step)
- Script Properties: `CC_URL`, `CC_TOKEN`, `ACCOUNT` (label, e.g. `main`), `CALENDAR_IDS` (comma list;
  default `primary`), `GMAIL_QUERY` (default below), `DAYS_BACK` 7, `DAYS_AHEAD` 60.
- `sync()`: CalendarApp events for each id in [today−DAYS_BACK, today+DAYS_AHEAD] (skip declined events
  where detectable); GmailApp.search(GMAIL_QUERY, 0, 50) → latest message per thread → plain body first 4000
  chars; one POST via UrlFetchApp (muteHttpExceptions, log status only — never log token/body).
- Default query: `newer_than:21d -category:promotions -category:social (subject:(review OR reviewer OR reviewing OR 심사) OR "invitation to review" OR "review is due")`.
- `setup()`: validates properties, runs `sync()` once, installs an hourly time-driven trigger for `sync`
  (idempotent — delete existing `sync` triggers first). `teardown()` removes triggers.
- README: script.google.com → new project → paste → set properties → run `setup` → authorize; how to add
  a second account (same script, different `ACCOUNT`); how to find calendar ids.

## 5. UI
- **Calendar** (`components/command-calendar.tsx` + calendar page): Google events render as a separate,
  visually lighter row type (outline chip with a small calendar icon, `HH:mm` prefix for timed events,
  multi-day as a bar using the existing lane segmentation from `lib/logic/calendar.ts`). Day popover lists
  them under `일정` (read-only). Toggle `Google 일정` in the calendar header, persisted in localStorage
  (try/catch). Holidays (calendar name contains "휴일"/"holiday") get a red date number instead of a chip.
- **Home**: checklist/today area shows today's timed events compactly (`오늘 일정`: up to 5).
- **Reviews** (papers page reviews section): top panel `메일에서 감지됨 — 확인 필요 (n)` when pending
  candidates exist: each row shows kind badge, journal, manuscript id, title, due date (editable date input),
  received date, link to the source (`https://mail.google.com/mail/#all/<messageId>` only if account is the
  primary; otherwise just the subject). Actions: **추가** → creates ReviewJob (status invitation→'invited',
  confirmation→'accepted', reminder→ updates existing ReviewJob with same manuscriptId if found, else creates
  'accepted') and a matching Deadline is NOT created separately (reviews already flow into upcoming/digest);
  **무시** → dismissed. If a ReviewJob with the same manuscriptId exists, the button reads `기존 리뷰 갱신`.
  Server actions in `app/actions/reviews.ts` with `requireUser()`.
- Home status/checklist header shows a small chip `리뷰 메일 확인 n` linking to the panel when n>0.
- **Telegram**: `/today` and the daily digest add `🗓 오늘 일정` (timed events today, then all-day,
  holidays excluded) — reuse existing format helpers; update tests.

## 6. Obsidian inbox (one-way) — collector extension
- Env (local only): `OBSIDIAN_VAULT` (absolute path), `OBSIDIAN_INBOX` default `00_memo/📥 CC Inbox.md`.
  Unset → skipped silently.
- If the inbox file is missing, create it with frontmatter (`title`, `tags: [command-center]`, `type: reference`)
  and two sections: `## 새 메모` (with an HTML comment explaining: one bullet per memo, `@프로젝트 #태그` ok)
  and `## 가져옴`.
- Each collector run: parse top-level bullets (`- text` or `- [ ] text`, continuation lines indented by 2+
  spaces are part of the memo) under `## 새 메모`. For each: `externalId = 'obsidian:' + sha1(normalized text)`;
  POST to `/api/capture` (CAPTURE_TOKEN) with `{ text, externalId, source: 'obsidian' }` — extend the capture
  route schema with optional `externalId` and `source` (enum: shortcut|obsidian, default shortcut).
- After successful POSTs, rewrite the file: remove imported bullets from `## 새 메모`, prepend them under
  `## 가져옴` as `- <text> <!-- cc:<noteId> YYYY-MM-DD -->`, keep at most 50 entries there (drop oldest).
  Failed items stay in place. Write atomically (temp + rename). Never touch any other file in the vault.
  If the file changed on disk between read and write (mtime check), skip the rewrite this run.
- Pure parse/rewrite in `scripts/lib/obsidian-inbox.mjs` with tests (continuation lines, checkbox form,
  empty section, missing sections, CRLF files, emoji filename handled by caller).
- Report in collector output: `Obsidian: n imported`.

## 7. Tests / acceptance
- Unit: review-mail parser fixtures, sync pure part (TZ edges), repo mappers for new entities, candidate
  upsert only-new semantics (LocalRepo), accept/dismiss action logic (pure helper), obsidian inbox parse/rewrite,
  capture externalId idempotency, format additions.
- Isolation gate passes (fictional fixtures only; no real addresses, names, calendar ids, or vault paths).
- typecheck, lint, tests, build pass. `npm run db:migrate` applies 0004.
- Implementer: generate `GOOGLE_SYNC_TOKEN` (append to `.env.local`, never print). Do **not** commit, push,
  deploy, or touch Vercel env — `main` auto-deploys, so the planner commits after review and does the live
  checks (Vercel env, synthetic `test`-account sync against prod, cleanup).
- Obsidian: never write the real vault — test by running the collector with `OBSIDIAN_VAULT=<scratch dir>`.
- Local end-to-end: run the dev server (:3100, LocalRepo is fine) and POST a synthetic sync payload
  (2 events, 2 fictional mails) with curl; check the calendar and reviews panel render (screenshot via the
  CDP approach in the scratchpad is optional). Kill the dev server tree afterwards.

## 8. Rubric
1. No Google OAuth client; tokens only in Script Properties / env; nothing logged.
2. Mail bodies never stored; only parsed fields + 300-char snippet.
3. Parser rejects the look-alike classes; dismissed candidates never reappear.
4. Calendar dates correct in KST (all-day exclusive end, midnight crossings).
5. Obsidian: only the inbox file is written, atomically, with conflict skip; imports idempotent by externalId.
6. Multi-account safe: replacing one account's events never deletes another's.

## Addendum A (2026-09-26, user answers — overrides above where different)
1. **Two Google accounts** install the script: `main` (reviewer invitations arrive here; the user
   had deleted old ones, which is why none were found) and `amc` (the professor forwards **revision
   letters** for the user's own papers here). Both push to the same endpoint.
2. **Revision letters are wanted** (overrides §2 "decisions on the user's own papers → null"):
   - New kind `revision`: editorial decision letters asking for major/minor revision or resubmission
     ("major revision", "minor revision", "revise and resubmit", "decision on your manuscript" + revise
     wording, 수정 후 재심). Forwarded mails ("Fwd:", "---------- Forwarded message") must parse the
     forwarded part. Extract journal, manuscriptId, title, dueDate (e.g. "submit your revision by …",
     "within 60 days"). Accept/reject/"manuscript received" notices stay null.
   - `ReviewCandidate.kind` gains `revision`; the Gmail default query adds
     `OR subject:(decision OR revision OR revise OR 수정)`.
   - Accept of a `revision` candidate: find the Paper whose latest submission journal matches
     (case-insensitive contains) or whose title matches; set that submission's decision to the matching
     revision value in `SubmissionDecision` (check lib/types.ts; use existing values like major/minor
     revision) and create a `Deadline` (kind 'paper', paperId set, dueDate from the letter, title
     `<paper short title> 리비전 제출`). If no paper matches, the panel offers a paper `<select>` (required
     before accept). Panel badge for revision: `리비전`.
   - Panel title becomes `메일에서 감지됨 — 확인 필요` (covers reviews + revisions); still shown on the
     papers page and the home chip reads `메일 확인 n`.
3. **Calendars**: default sync = the `main` account's primary calendar + Korean holidays + the
   professor's calendar (the user adds the professor calendar id to `CALENDAR_IDS`; README explains).
   UI: per-calendar visibility toggles in the calendar header (chips listing each distinct
   `calendar_name`, persisted in localStorage). Defaults: primary on, holidays render as red dates
   (not a toggle), **any other calendar defaults off** until toggled on. `/today` + digest include only
   calendars currently marked visible — since that's client state, store the visibility set server-side
   instead: `app_meta` key `calendar:visible` (string[] of calendar names; server action to update;
   localStorage not needed). Home `오늘 일정` respects it too.
