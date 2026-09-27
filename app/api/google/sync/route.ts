import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';
import {
  buildCalendarEvents,
  buildReviewCandidateInputs,
  candidatesToDismiss,
  deadlinesForCalendar,
  dropDuplicateCandidates,
  shouldPushCandidate,
} from '@/lib/google/sync';
import { sendMessage, telegramConfig } from '@/lib/telegram/client';
import { escapeHtml } from '@/lib/telegram/format';
import { todayKST } from '@/lib/logic/dates';
import { findMatchingPaper } from '@/lib/logic/review-candidates';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 1024 * 1024; // 1 MB, per docs/PLAN_3.md §3

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const calendarEventSchema = z.object({
  calendarId: z.string().min(1),
  calendarName: z.string().min(1),
  eventId: z.string().min(1),
  title: z.string(),
  start: z.string().min(1),
  end: z.string().min(1),
  allDay: z.boolean(),
  location: z.string().nullable().optional(),
});

const mailSchema = z.object({
  messageId: z.string().min(1),
  threadId: z.string().min(1),
  receivedAt: z.string().min(1),
  from: z.string().min(1),
  subject: z.string(),
  body: z.string().max(4000),
});

const bodySchema = z.object({
  account: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9._@-]+$/),
  calendar: z
    .object({
      from: dateSchema,
      to: dateSchema,
      events: z.array(calendarEventSchema).max(2000),
    })
    .optional(),
  mails: z.array(mailSchema).max(200).optional(),
  // Message ids of recent review-ish mail now in Gmail trash (declined invitations).
  trashedMessageIds: z.array(z.string().min(1)).max(1000).optional(),
});

/** For the Google Apps Script installed per account (integrations/google/Code.gs).
 * Bearer-token auth (GOOGLE_SYNC_TOKEN). No OAuth client lives in this app. */
export async function POST(request: Request) {
  const auth = checkBearer(request, process.env.GOOGLE_SYNC_TOKEN);
  if (auth === 'missing-config') {
    return NextResponse.json({ ok: false, error: 'GOOGLE_SYNC_TOKEN not configured' }, { status: 503 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf-8') > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'payload too large' }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }

  const repo = getRepo();
  const now = new Date().toISOString();
  const { account, calendar, mails, trashedMessageIds } = parsed.data;

  let eventCount = 0;
  if (calendar) {
    const events = buildCalendarEvents(account, now, calendar.events);
    await repo.replaceCalendarEvents(account, calendar.from, calendar.to, events);
    eventCount = events.length;
  }

  let newCandidates: Awaited<ReturnType<typeof repo.upsertReviewCandidates>> = [];
  let totalCandidates = 0;
  if (mails || trashedMessageIds) {
    if (mails) {
      const known = await repo.listReviewCandidates();
      const knownIds = new Set(known.map((c) => c.messageId));
      // Messages already stored keep flowing through upsert (a no-op for them); only
      // new messages are checked against the other account's copies.
      const inputs = buildReviewCandidateInputs(account, mails);
      const fresh = dropDuplicateCandidates(
        inputs.filter((c) => !knownIds.has(c.messageId)),
        known
      );
      newCandidates = await repo.upsertReviewCandidates(fresh);
      await backfillDueDates(repo, inputs, known);
    }
    let pending = await repo.listReviewCandidates('pending');
    if (trashedMessageIds && trashedMessageIds.length > 0) {
      const dismiss = candidatesToDismiss(pending, trashedMessageIds);
      for (const c of dismiss) await repo.updateReviewCandidate(c.id, { status: 'dismissed' });
      const dismissed = new Set(dismiss.map((c) => c.id));
      pending = pending.filter((c) => !dismissed.has(c.id));
      newCandidates = newCandidates.filter((c) => !dismissed.has(c.id));
    }
    totalCandidates = pending.length;

    const toPush = newCandidates.filter((c) => shouldPushCandidate(c.kind));
    if (toPush.length > 0 && telegramConfig()) {
      await sendMessage(formatNewCandidatesAlert(toPush));
    }
  }

  // Settings §5.8 연동 상태 rows read this back (PLAN_UX.md decision 3).
  await repo.setMeta(`integration:google:${account}`, {
    at: now,
    detail: `캘린더 ${eventCount}개 · 후보 ${totalCandidates}개`,
  });

  // The Apps Script mirrors these into Google Calendar when WRITE_DEADLINES is set.
  const [deadlines, reviews] = await Promise.all([repo.listDeadlines(), repo.listReviews()]);

  return NextResponse.json({
    ok: true,
    events: eventCount,
    candidates: { new: newCandidates.length, total: totalCandidates },
    deadlines: deadlinesForCalendar(deadlines, reviews, todayKST()),
  });
}

/** A stored candidate whose due date wasn't found the first time (e.g. before the
 * Apps Script started sending due-date lines past 3000 chars) picks it up on a later
 * sync. An already-accepted revision also gets its paper Deadline then. */
async function backfillDueDates(
  repo: ReturnType<typeof getRepo>,
  inputs: ReturnType<typeof buildReviewCandidateInputs>,
  known: Awaited<ReturnType<ReturnType<typeof getRepo>['listReviewCandidates']>>
) {
  const byMessage = new Map(known.map((c) => [c.messageId, c]));
  for (const input of inputs) {
    const stored = byMessage.get(input.messageId);
    if (!stored || stored.dueDate || !input.dueDate) continue;
    const updated = await repo.updateReviewCandidate(stored.id, { dueDate: input.dueDate });
    if (updated.kind !== 'revision' || updated.status !== 'accepted') continue;
    const [papers, deadlines] = await Promise.all([repo.listPapers(), repo.listDeadlines()]);
    const paper = findMatchingPaper(updated, papers);
    if (!paper || deadlines.some((d) => d.paperId === paper.id && !d.done)) continue;
    await repo.createDeadline({
      title: `${paper.shortName} 리비전 제출${updated.journal ? ` (${updated.journal})` : ''}`,
      kind: 'paper',
      paperId: paper.id,
      dueDate: input.dueDate,
    });
  }
}

function formatNewCandidatesAlert(
  candidates: Array<{
    kind: string;
    journal: string | null;
    manuscriptId: string | null;
    dueDate: string | null;
  }>
): string {
  const cloudUrl = process.env.CLOUD_URL;
  const maxItems = cloudUrl ? 4 : 5; // total message stays <=5 lines including the link
  const lines = candidates.slice(0, maxItems).map((c) => {
    const journal = c.journal ? escapeHtml(c.journal) : '(저널 미상)';
    const ms = c.manuscriptId ? ` ${escapeHtml(c.manuscriptId)}` : '';
    const due = c.dueDate ? c.dueDate.slice(5) : '미상';
    const label = c.kind === 'revision' ? '📝 내 논문 리비전' : '⏰ 리뷰 마감 알림';
    return `${label}: ${journal}${ms} · 마감 ${due}`;
  });
  if (cloudUrl) lines.push(`${cloudUrl.replace(/\/$/, '')}/papers?tab=review`);
  return lines.join('\n');
}
