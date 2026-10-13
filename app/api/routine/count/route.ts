import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';
import { todayKST } from '@/lib/logic/dates';
import { activeRoutines, isCountRoutine, MAX_ROUTINE_COUNT } from '@/lib/logic/routines';
import { changeRoutineCount, loadRoutineItems } from '@/lib/routines-data';
import { revalidateAll } from '@/app/actions/revalidate';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    id: z.string().min(1).max(64),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    add: z.number().int().min(-MAX_ROUTINE_COUNT).max(MAX_ROUTINE_COUNT).optional(),
    set: z.number().int().min(0).max(MAX_ROUTINE_COUNT).optional(),
    atLeast: z.number().int().min(0).max(MAX_ROUTINE_COUNT).optional(),
  })
  .refine((b) => [b.add, b.set, b.atLeast].filter((x) => x !== undefined).length <= 1, {
    message: 'add, set and atLeast are exclusive',
  });

/**
 * For scripts/routine-count.mjs (e.g. a study session logging solved problems).
 * Bearer-token auth (AGENT_TOKEN). Body `{id, add?|set?|atLeast?, date?}`; none of them
 * just reads. `atLeast` raises the count but never lowers it (for automated syncs). The routine must be an active kind 'count' routine on that date.
 */
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

  const { id, add, set, atLeast } = parsed.data;
  const date = parsed.data.date ?? todayKST();
  const repo = getRepo();
  const item = activeRoutines(await loadRoutineItems(repo), date).find((r) => r.id === id);
  if (!item || !isCountRoutine(item)) {
    return NextResponse.json({ ok: false, error: `no active count routine '${id}' on ${date}` }, { status: 404 });
  }
  const change = set !== undefined ? { set } : atLeast !== undefined ? { atLeast } : { add: add ?? 0 };
  const count = await changeRoutineCount(repo, id, date, change);
  if (add || set !== undefined || atLeast !== undefined) revalidateAll();
  return NextResponse.json({ ok: true, id, date, count, unit: item.unit ?? null });
}
