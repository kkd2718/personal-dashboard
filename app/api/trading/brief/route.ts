import { NextResponse } from 'next/server';
import { checkBearer } from '@/lib/auth/bearer';
import { parseBrief } from '@/lib/logic/market-brief';
import { storeBrief } from '@/lib/market-brief-data';
import { getRepo } from '@/lib/repo';
import { notifyTradesFail } from '@/lib/telegram/trades-alert';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 64 * 1024;

/** The trading VM pushes a market-only snapshot here (bearer TRADING_BRIEF_TOKEN). Allow-listed fields
 * only (lib/logic/market-brief.ts); re-pushing the same `as_of` simply overwrites. A trade check newly
 * failing sends one Telegram alert. */
export async function POST(request: Request) {
  const auth = checkBearer(request, process.env.TRADING_BRIEF_TOKEN);
  if (auth === 'missing-config') {
    return NextResponse.json({ ok: false, error: 'TRADING_BRIEF_TOKEN not configured' }, { status: 503 });
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
  const body = parseBrief(json);
  if (!body) return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });

  const { alerted } = await storeBrief(getRepo(), body, 'vm', new Date().toISOString(), notifyTradesFail);
  return NextResponse.json({ ok: true, as_of: body.as_of, alerted });
}
