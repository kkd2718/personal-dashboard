import { NextResponse } from 'next/server';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';
import { telegramConfig, sendMessage } from '@/lib/telegram/client';
import { runDigest, type DigestResult } from '@/lib/telegram/digest';
import { todayKST } from '@/lib/logic/dates';

export const dynamic = 'force-dynamic';

type CronDigest = DigestResult | 'disabled';

/** Vercel Hobby cron: once per day, sends `Authorization: Bearer ${CRON_SECRET}`.
 * One daily job for everything: heartbeat, then (phase 2b) the Telegram digest.
 * `?force=1` bypasses the once-per-day digest guard for manual testing — still
 * requires CRON_SECRET. A Telegram failure never fails the cron (heartbeat stays
 * green) — see docs/reviews/plan-advice.md §4 on Hobby's once-per-day cron limit. */
export async function GET(request: Request) {
  const auth = checkBearer(request, process.env.CRON_SECRET);
  if (auth === 'missing-config') {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const at = new Date().toISOString();
  const repo = getRepo();
  await repo.setHeartbeat(at);

  const force = new URL(request.url).searchParams.has('force');
  let digest: CronDigest = 'disabled';
  if (telegramConfig()) {
    digest = await runDigest(repo, sendMessage, todayKST(), force, process.env.CLOUD_URL ?? null);
  }

  return NextResponse.json({ ok: true, at, digest });
}
