import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';
import { buildCalendarEvents, buildReviewCandidateInputs } from '@/lib/google/sync';
import { sendMessage, telegramConfig } from '@/lib/telegram/client';
import { escapeHtml } from '@/lib/telegram/format';

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
  const { account, calendar, mails } = parsed.data;

  let eventCount = 0;
  if (calendar) {
    const events = buildCalendarEvents(account, now, calendar.events);
    await repo.replaceCalendarEvents(account, calendar.from, calendar.to, events);
    eventCount = events.length;
  }

  let newCandidates: Awaited<ReturnType<typeof repo.upsertReviewCandidates>> = [];
  let totalCandidates = 0;
  if (mails) {
    const inputs = buildReviewCandidateInputs(account, mails);
    newCandidates = await repo.upsertReviewCandidates(inputs);
    totalCandidates = (await repo.listReviewCandidates('pending')).length;

    if (newCandidates.length > 0 && telegramConfig()) {
      await sendMessage(formatNewCandidatesAlert(newCandidates));
    }
  }

  // Settings §5.8 연동 상태 rows read this back (PLAN_UX.md decision 3).
  await repo.setMeta(`integration:google:${account}`, {
    at: now,
    detail: `캘린더 ${eventCount}개 · 후보 ${totalCandidates}개`,
  });

  return NextResponse.json({
    ok: true,
    events: eventCount,
    candidates: { new: newCandidates.length, total: totalCandidates },
  });
}

function formatNewCandidatesAlert(
  candidates: Array<{ journal: string | null; manuscriptId: string | null; dueDate: string | null }>
): string {
  const cloudUrl = process.env.CLOUD_URL;
  const maxItems = cloudUrl ? 4 : 5; // total message stays <=5 lines including the link
  const lines = candidates.slice(0, maxItems).map((c) => {
    const journal = c.journal ? escapeHtml(c.journal) : '(저널 미상)';
    const ms = c.manuscriptId ? ` ${escapeHtml(c.manuscriptId)}` : '';
    const due = c.dueDate ? c.dueDate.slice(5) : '미상';
    return `📨 리뷰 메일 감지: ${journal}${ms} · 마감 ${due}`;
  });
  if (cloudUrl) lines.push(`${cloudUrl.replace(/\/$/, '')}/papers?tab=review`);
  return lines.join('\n');
}
