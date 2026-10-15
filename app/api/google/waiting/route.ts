import { NextResponse } from 'next/server';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';
import { waitingQueries } from '@/lib/logic/waiting';
import { loadWaiting } from '@/lib/waiting-data';

export const dynamic = 'force-dynamic';

/** For the per-account Apps Script (integrations/google/Code.gs): the Gmail searches to
 * run for open reply-waits. Same bearer token as /api/google/sync. */
export async function GET(request: Request) {
  const auth = checkBearer(request, process.env.GOOGLE_SYNC_TOKEN);
  if (auth === 'missing-config') {
    return NextResponse.json({ ok: false, error: 'GOOGLE_SYNC_TOKEN not configured' }, { status: 503 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, items: waitingQueries(await loadWaiting(getRepo())) });
}
