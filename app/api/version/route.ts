import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Build id of the running deployment — VersionWatcher compares it with its own baked-in copy. */
export async function GET() {
  return NextResponse.json({ version: process.env.CC_APP_VERSION ?? 'dev' }, { headers: { 'cache-control': 'no-store' } });
}
