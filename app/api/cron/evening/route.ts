import { NextResponse } from 'next/server';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';
import { telegramConfig, sendMessage } from '@/lib/telegram/client';
import { runEvening, type EveningResult } from '@/lib/telegram/evening';
import { todayKST } from '@/lib/logic/dates';

export const dynamic = 'force-dynamic';

/** Vercel cron, 12:00 UTC (~21:00 KST): evening routine reminder. Same CRON_SECRET auth
 * as /api/cron/daily; `?force=1` bypasses the once-per-day guard. `next dev` never
 * sends (sendMessage's TELEGRAM_DEV_SEND rule). */
export async function GET(request: Request) {
  const auth = checkBearer(request, process.env.CRON_SECRET);
  if (auth === 'missing-config') {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const force = new URL(request.url).searchParams.has('force');
  let evening: EveningResult | 'disabled' = 'disabled';
  if (telegramConfig()) {
    evening = await runEvening(getRepo(), sendMessage, todayKST(), force);
  }
  return NextResponse.json({ ok: true, evening });
}
