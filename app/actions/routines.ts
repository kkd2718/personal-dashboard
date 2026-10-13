'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import { revalidateAll } from '@/app/actions/revalidate';
import { requireUser } from '@/lib/auth/require-user';
import { MAX_ROUTINE_COUNT, ROUTINE_ITEMS_META_KEY, routineDoneMetaKey, type RoutineItem } from '@/lib/logic/routines';
import { changeRoutineCount } from '@/lib/routines-data';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const routineSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(60),
  url: z
    .string()
    .trim()
    .max(500)
    .regex(/^(https?:\/\/\S+)?$/)
    .nullable()
    .transform((u) => u || null),
  startDate: dateStr,
  endDate: dateStr.nullable(),
  kind: z.enum(['check', 'count']).optional(),
  unit: z
    .string()
    .trim()
    .max(10)
    .nullable()
    .optional()
    .transform((u) => u || null),
});

const routinesSchema = z
  .array(routineSchema)
  .max(10)
  .refine((r) => new Set(r.map((x) => x.id)).size === r.length, 'duplicate id')
  .refine((r) => r.every((x) => x.endDate === null || x.endDate >= x.startDate), 'endDate before startDate');

/** Tick/untick one routine for a KST day. */
export async function toggleRoutineAction(id: string, date: string, done: boolean): Promise<void> {
  await requireUser();
  const input = z.object({ id: z.string().min(1).max(64), date: dateStr, done: z.boolean() }).parse({ id, date, done });
  const repo = getRepo();
  const key = routineDoneMetaKey(input.date);
  const current = (await repo.getMeta<string[]>(key)) ?? [];
  const next = input.done ? [...new Set([...current, input.id])] : current.filter((x) => x !== input.id);
  await repo.setMeta(key, next);
  revalidateAll();
}

/** Sets a count routine's tally for a KST day (done when > 0). */
export async function setRoutineCountAction(id: string, date: string, count: number): Promise<number> {
  await requireUser();
  const input = z
    .object({ id: z.string().min(1).max(64), date: dateStr, count: z.number().int().min(0).max(MAX_ROUTINE_COUNT) })
    .parse({ id, date, count });
  const next = await changeRoutineCount(getRepo(), input.id, input.date, { set: input.count });
  revalidateAll();
  return next;
}

/** Replaces the routine list (settings); `sort` follows array order. */
export async function saveRoutinesAction(items: Omit<RoutineItem, 'sort'>[]): Promise<void> {
  await requireUser();
  const parsed = routinesSchema.parse(items);
  await getRepo().setMeta(
    ROUTINE_ITEMS_META_KEY,
    parsed.map((r, sort): RoutineItem => ({ ...r, sort }))
  );
  revalidateAll();
}
