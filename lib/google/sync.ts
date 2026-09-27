// Pure payload -> domain-object transform for POST /api/google/sync (phase 3).
// No repo/network access — the route calls repo.replaceCalendarEvents /
// repo.upsertReviewCandidates with the results of these functions.
import { addDaysStr, kstDateTime } from '@/lib/logic/dates';
import { parseReviewMail } from '@/lib/logic/review-mail';
import type { CalendarEvent, Deadline, ReviewCandidate, ReviewJob } from '@/lib/types';

export interface SyncCalendarEventInput {
  calendarId: string;
  calendarName: string;
  eventId: string;
  title: string;
  start: string; // ISO instant
  end: string; // ISO instant (Google's all-day end is exclusive)
  allDay: boolean;
  location?: string | null;
}

export interface SyncMailInput {
  messageId: string;
  threadId: string;
  receivedAt: string; // ISO instant
  from: string;
  subject: string;
  body: string; // never persisted — only parsed fields + a snippet survive
}

/** Converts one Google Calendar event to KST domain fields. All-day events'
 * exclusive end (Google convention) becomes an inclusive end_date one day earlier. */
export function buildCalendarEvent(account: string, now: string, e: SyncCalendarEventInput): CalendarEvent {
  // CalendarApp gives every instance of a recurring event the same id, so the start
  // instant is part of the key (duplicate ids made the replace RPC fail with a 500).
  const id = `${account}:${e.calendarId}:${e.eventId}:${e.start}`;
  if (e.allDay) {
    const startDate = kstDateTime(e.start).date;
    const endExclusive = kstDateTime(e.end).date;
    const endDate = endExclusive > startDate ? addDaysStr(endExclusive, -1) : startDate;
    return {
      id,
      account,
      calendarName: e.calendarName,
      title: e.title,
      startDate,
      endDate,
      startTime: null,
      endTime: null,
      location: e.location ?? null,
      updatedAt: now,
    };
  }
  const start = kstDateTime(e.start);
  const end = kstDateTime(e.end);
  return {
    id,
    account,
    calendarName: e.calendarName,
    title: e.title,
    startDate: start.date,
    endDate: end.date,
    startTime: start.time,
    endTime: end.time,
    location: e.location ?? null,
    updatedAt: now,
  };
}

export function buildCalendarEvents(account: string, now: string, events: SyncCalendarEventInput[]): CalendarEvent[] {
  return events.map((e) => buildCalendarEvent(account, now, e));
}

/** First 300 chars of `text`, whitespace-collapsed — the only trace of the mail
 * body ever stored (the body itself is discarded after parsing). */
export function makeSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

export type ReviewCandidateInput = Omit<ReviewCandidate, 'id' | 'status' | 'reviewId' | 'createdAt' | 'updatedAt'>;

/** Parses each mail with lib/logic/review-mail; non-assignments (parseReviewMail
 * -> null) are dropped entirely, never reaching storage. */
export function buildReviewCandidateInputs(account: string, mails: SyncMailInput[]): ReviewCandidateInput[] {
  const out: ReviewCandidateInput[] = [];
  for (const mail of mails) {
    const parsed = parseReviewMail({
      from: mail.from,
      subject: mail.subject,
      body: mail.body,
      receivedAt: mail.receivedAt,
    });
    if (!parsed) continue;
    out.push({
      account,
      messageId: mail.messageId,
      receivedAt: mail.receivedAt,
      fromAddr: mail.from,
      subject: mail.subject,
      snippet: makeSnippet(mail.body),
      kind: parsed.kind,
      journal: parsed.journal,
      manuscriptId: parsed.manuscriptId,
      title: parsed.title,
      dueDate: parsed.dueDate,
      link: parsed.link,
      revisionType: parsed.revisionType,
    });
  }
  return out;
}

/** Pending candidates whose Gmail message the user has since trashed. The owner
 * deletes invitations after declining them, so a trashed mail means "handled". */
export function candidatesToDismiss<T extends { messageId: string; status: string }>(
  pending: T[],
  trashedMessageIds: string[]
): T[] {
  const trashed = new Set(trashedMessageIds);
  return pending.filter((c) => c.status === 'pending' && trashed.has(c.messageId));
}

// Pushed to Telegram right away: revision letters and deadline reminders for reviews
// already accepted. Invitations are not pushed (the owner sees them in Gmail and
// usually declines and deletes them); confirmation/completed follow the owner's own action.
const PUSH_KINDS: ReadonlySet<ReviewCandidate['kind']> = new Set(['revision', 'reminder']);

export function shouldPushCandidate(kind: ReviewCandidate['kind']): boolean {
  return PUSH_KINDS.has(kind);
}

export interface CalendarDeadline {
  key: string; // stable marker the Apps Script stores in the event description
  title: string;
  date: string; // 'YYYY-MM-DD' KST, all-day
}

/** Open deadlines + accepted reviews' due dates (from a week ago on), for the Apps
 * Script to mirror into Google Calendar as all-day events. A review that already has
 * its own Deadline row (reviewId) isn't listed twice. */
export function deadlinesForCalendar(deadlines: Deadline[], reviews: ReviewJob[], today: string): CalendarDeadline[] {
  const from = addDaysStr(today, -7);
  const out: CalendarDeadline[] = [];
  const reviewsWithDeadline = new Set<string>();
  for (const d of deadlines) {
    if (d.reviewId) reviewsWithDeadline.add(d.reviewId);
    if (d.done || d.dueDate < from) continue;
    out.push({ key: `deadline:${d.id}`, title: `📌 ${d.title}`, date: d.dueDate });
  }
  for (const r of reviews) {
    if (r.status !== 'accepted' || !r.dueDate || r.dueDate < from || reviewsWithDeadline.has(r.id)) continue;
    const ms = r.manuscriptId ? ` ${r.manuscriptId}` : '';
    out.push({ key: `review:${r.id}`, title: `📌 ${r.journal}${ms} 리뷰 마감`, date: r.dueDate });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function subjectKey(subject: string): string {
  return subject.replace(/^(?:\s*(?:fwd?|re|fw|전달)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function dedupKey(c: { kind: string; manuscriptId: string | null; subject: string }): string {
  return `${c.kind}|${c.manuscriptId ?? subjectKey(c.subject)}`;
}

/** Both accounts can receive the same letter (the journal writes to one, the
 * professor forwards it to the other), so a candidate whose kind + manuscript id
 * (or, without an id, its Fwd:/Re:-stripped subject) is already known — in any
 * account, any status — or repeats within this batch is dropped. */
export function dropDuplicateCandidates<
  T extends { kind: string; manuscriptId: string | null; subject: string },
>(inputs: T[], existing: Array<{ kind: string; manuscriptId: string | null; subject: string }>): T[] {
  const seen = new Set(existing.map(dedupKey));
  const out: T[] = [];
  for (const c of inputs) {
    const key = dedupKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** "Thank you for your review" mails aren't a to-do (the owner only tracks reviews
 * still to write): they never become candidates, they only close the matching open
 * ReviewJob. Returns the job ids to mark 'submitted'. */
export function reviewsToMarkSubmitted(
  inputs: Array<{ kind: string; manuscriptId: string | null }>,
  reviews: ReviewJob[]
): string[] {
  const ids = new Set(
    inputs.filter((c) => c.kind === 'completed' && c.manuscriptId).map((c) => c.manuscriptId as string)
  );
  return reviews
    .filter((r) => r.manuscriptId && ids.has(r.manuscriptId) && (r.status === 'invited' || r.status === 'accepted'))
    .map((r) => r.id);
}
