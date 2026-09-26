import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({ taskId: z.string().min(1).optional(), noteId: z.string().min(1).optional() })
  .refine((b) => Boolean(b.taskId) !== Boolean(b.noteId), { message: 'exactly one of taskId/noteId required' });

/** For scripts/cc-inbox.mjs `done` command. Bearer-token auth (AGENT_TOKEN). Idempotent. */
export async function POST(request: Request) {
  const auth = checkBearer(request, process.env.AGENT_TOKEN);
  if (auth === 'missing-config') {
    return NextResponse.json({ ok: false, error: 'AGENT_TOKEN not configured' }, { status: 503 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }

  const repo = getRepo();
  try {
    if (parsed.data.taskId) {
      await repo.updateTask(parsed.data.taskId, { status: 'done' });
    } else if (parsed.data.noteId) {
      await repo.updateNote(parsed.data.noteId, { status: 'done' });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
