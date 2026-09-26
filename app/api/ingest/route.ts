import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 256 * 1024;

const statusItemSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['critical', 'warn', 'info', 'ok']),
  source: z.enum(['trading', 'git']),
  projectId: z.string().nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  href: z.string().nullable(),
});

const projectActivitySchema = z.object({
  projectId: z.string().min(1),
  branch: z.string().nullable(),
  lastCommitAt: z.string().nullable(),
  lastCommitMsg: z.string().nullable(),
  dirty: z.boolean().nullable(),
  lastSessionAt: z.string().nullable(),
  memoryDigest: z.string().nullable(),
  metrics: z.record(z.string(), z.union([z.number(), z.string()])),
  collectedAt: z.string(),
});

const bodySchema = z.object({
  statusItems: z.array(statusItemSchema),
  projectActivity: z.array(projectActivitySchema).optional(),
});

/** For the status collector (phase 2) / scripts/push-status.mjs. Bearer-token auth (INGEST_TOKEN). */
export async function POST(request: Request) {
  const auth = checkBearer(request, process.env.INGEST_TOKEN);
  if (auth === 'missing-config') {
    return NextResponse.json({ ok: false, error: 'INGEST_TOKEN not configured' }, { status: 503 });
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
  const collectedAt = new Date().toISOString();
  await repo.setStatusSnapshot({ items: parsed.data.statusItems, collectedAt });
  if (parsed.data.projectActivity) {
    await Promise.all(parsed.data.projectActivity.map((a) => repo.upsertProjectActivity(a)));
  }

  return NextResponse.json({ ok: true, collectedAt });
}
