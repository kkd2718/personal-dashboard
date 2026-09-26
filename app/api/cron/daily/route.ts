import { NextResponse } from 'next/server';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';

export const dynamic = 'force-dynamic';

/** Vercel Hobby cron: once per day, sends `Authorization: Bearer ${CRON_SECRET}`.
 * One daily job for everything (heartbeat now; D-7/3/1 reminders land in a later
 * phase) — see docs/reviews/plan-advice.md §4 on Hobby's once-per-day cron limit. */
export async function GET(request: Request) {
  const auth = checkBearer(request, process.env.CRON_SECRET);
  if (auth === 'missing-config') {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const at = new Date().toISOString();
  await getRepo().setHeartbeat(at);

  return NextResponse.json({ ok: true, at });
}
