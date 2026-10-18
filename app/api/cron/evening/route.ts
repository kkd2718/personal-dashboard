import { NextResponse } from 'next/server';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';
import { telegramConfig, sendMessage } from '@/lib/telegram/client';
import { runEvening, type EveningResult } from '@/lib/telegram/evening';
import { runWeekly, type WeeklyResult } from '@/lib/telegram/weekly';
import { createJev, jevToken } from '@/lib/ai/jev';
import { todayKST } from '@/lib/logic/dates';

export const dynamic = 'force-dynamic';

/** Vercel cron, 12:00 UTC (~21:00 KST): evening routine reminder, plus the Sunday weekly
 * review (a separate message; `?weekly=1` forces it on any day). Same CRON_SECRET auth
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

  const params = new URL(request.url).searchParams;
  const force = params.has('force');
  let evening: EveningResult | 'disabled' = 'disabled';
  let weekly: WeeklyResult | 'disabled' = 'disabled';
  if (telegramConfig()) {
    const repo = getRepo();
    const today = todayKST();
    try {
      evening = await runEvening(repo, sendMessage, today, force);
    } catch {
      evening = 'failed'; // the weekly review still runs
    }
    try {
      weekly = await runWeekly(repo, (text, markup) => sendMessage(text, { replyMarkup: markup }), today, {
        force: params.has('weekly'),
        jev: createJev({ token: jevToken(process.env, request.headers) }),
      });
    } catch {
      weekly = 'failed'; // never fail the evening reminder over the weekly review
    }
  }
  return NextResponse.json({ ok: true, evening, weekly });
}
