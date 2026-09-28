import { NextResponse } from 'next/server';
import { TRADING_SUMMARY_META_KEY } from '@/lib/logic/trading';
import { z } from 'zod';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';
import { newCriticalItems } from '@/lib/logic/status-diff';
import { projectDetailMetaKey } from '@/lib/logic/project-detail';
import { telegramConfig, sendMessage } from '@/lib/telegram/client';
import { formatCriticalAlert } from '@/lib/telegram/format';

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

const ccChecklistItemSchema = z.object({
  text: z.string().max(200),
  status: z.enum(['todo', 'doing', 'blocked', 'done']),
  section: z.string().max(40).nullable(),
  owner: z.enum(['me', 'agent']),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const ccStatusSchema = z.object({
  updatedAt: z.string().nullable(),
  focus: z.string().max(200).nullable(),
  next: z.array(z.string().max(200)).max(8),
  blockers: z.array(z.string().max(200)).max(8),
  done: z.array(z.object({ date: z.string().nullable(), text: z.string().max(200) })).max(10),
  checklist: z.array(ccChecklistItemSchema).max(60),
});

const projectDetailSchema = z.object({
  projectId: z.string().min(1),
  collectedAt: z.string(),
  openItems: z.record(z.string(), z.array(z.string().max(200)).max(15)).refine((o) => Object.keys(o).length <= 10, {
    message: 'openItems: max 10 labels',
  }),
  status: ccStatusSchema.nullable(),
});

const bodySchema = z.object({
  statusItems: z.array(statusItemSchema),
  projectActivity: z.array(projectActivitySchema).optional(),
  projectDetails: z.array(projectDetailSchema).max(50).optional(),
  obsidian: z.object({ imported: z.number().int().min(0) }).optional(),
  trading: z
    .object({
      collectedAt: z.string(),
      totalKrw: z.number().nullable(),
      dayChangeKrw: z.number().nullable(),
      dayChangePct: z.number().nullable(),
      fxRate: z.number().nullable(),
      lastSyncOk: z.boolean().nullable(),
      points: z.array(z.object({ date: z.string(), totalKrw: z.number() })).max(60),
      accounts: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            group: z.string().nullable(),
            currency: z.string().nullable(),
            totalValue: z.number().nullable(),
            cumReturnPct: z.number().nullable(),
            sinceBaselinePct: z.number().nullable().optional(),
            baselineDate: z.string().nullable().optional(),
            noData: z.boolean(),
            reserveUsd: z.number().nullable().optional(),
            status: z.string().nullable(),
            dormantUntil: z.string().nullable(),
            lastRun: z.string().nullable(),
            nextDue: z.string().nullable(),
          })
        )
        .max(20),
    })
    .optional(),
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
  const prev = await repo.getStatusSnapshot();
  await repo.setStatusSnapshot({ items: parsed.data.statusItems, collectedAt });
  if (parsed.data.projectActivity) {
    await Promise.all(parsed.data.projectActivity.map((a) => repo.upsertProjectActivity(a)));
  }
  // A collector run that failed to read a project's files just omits it here — never
  // wipe the last good detail for a project absent from this payload.
  if (parsed.data.projectDetails) {
    await Promise.all(
      parsed.data.projectDetails.map((d) => repo.setMeta(projectDetailMetaKey(d.projectId), d))
    );
  }
  // Settings §5.8 연동 상태 rows read this back (PLAN_UX.md decision 3).
  await repo.setMeta('integration:collector', {
    at: collectedAt,
    detail: `${parsed.data.projectActivity?.length ?? 0}개 프로젝트`,
  });
  if (parsed.data.trading) {
    await repo.setMeta(TRADING_SUMMARY_META_KEY, parsed.data.trading);
  }
  if (parsed.data.obsidian) {
    const n = parsed.data.obsidian.imported;
    await repo.setMeta('integration:obsidian', { at: collectedAt, detail: n > 0 ? `메모 ${n}건 가져옴` : '확인함 · 새 메모 없음' });
  }

  // Immediate alert on newly-critical status only (no hourly repeats) — a Telegram
  // failure here never fails ingest itself.
  let alerted = 0;
  if (telegramConfig()) {
    const newCritical = newCriticalItems(prev?.items ?? [], parsed.data.statusItems);
    if (newCritical.length > 0) {
      const result = await sendMessage(formatCriticalAlert(newCritical));
      if (result.ok) alerted = newCritical.length;
    }
  }

  return NextResponse.json({ ok: true, collectedAt, alerted });
}
