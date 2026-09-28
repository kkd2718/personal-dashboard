'use server';

// CareNote server actions (PLAN_CARENOTE.md §2). Nothing here touches the dashboard's
// own Repo/DB — this proxies a workspace-token-authenticated external API and holds
// no state of its own. Never revalidates a dashboard path: the client updates its
// own state after a mutation.
import { z } from 'zod';
import { requireUser } from '@/lib/auth/require-user';
import { addDaysStr } from '@/lib/logic/dates';
import {
  CareNoteError,
  createCareRecord,
  deleteCareRecord,
  getCareMeta,
  listCareRecords,
  updateCareRecord,
} from '@/lib/carenote/client';
import { careErrorMessage } from '@/lib/logic/carenote';
import type { CareApiError } from '@/lib/carenote/types';

const MAX_RANGE_DAYS = 62;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Interpolated into the upstream URL path, so it must be a plain positive integer.
const idSchema = z.number().int().positive();

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string> };

function toResult(err: unknown): { ok: false; error: string; code: string; fieldErrors?: Record<string, string> } {
  if (err instanceof CareNoteError) {
    const apiErr: CareApiError = { code: err.code, message: err.message, fieldErrors: err.fieldErrors, status: err.status };
    return { ok: false, error: careErrorMessage(apiErr), code: err.code, fieldErrors: err.fieldErrors };
  }
  return { ok: false, error: '케어노트에 연결할 수 없어요', code: 'unreachable' };
}

const loadMonthSchema = z
  .object({ from: dateSchema, to: dateSchema })
  .refine(({ from, to }) => from <= to, { message: 'from must be <= to' });

export async function loadCareMonthAction(
  from: string,
  to: string
): Promise<ActionResult<Awaited<ReturnType<typeof getCareMeta>> & { records: Awaited<ReturnType<typeof listCareRecords>> }>> {
  await requireUser();
  try {
    const parsed = loadMonthSchema.parse({ from, to });
    const maxTo = addDaysStr(parsed.from, MAX_RANGE_DAYS);
    const clampedTo = parsed.to > maxTo ? maxTo : parsed.to;
    const [{ persons, procedureTypes }, records] = await Promise.all([
      getCareMeta(),
      listCareRecords(parsed.from, clampedTo),
    ]);
    return { ok: true, data: { persons, procedureTypes, records } };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: '입력값을 확인하세요', code: 'bad_request' };
    }
    return toResult(err);
  }
}

const paramValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.string(), z.number()),
]);

const createSchema = z.object({
  personId: z.number().int(),
  procedureTypeId: z.number().int(),
  date: dateSchema,
  params: z.record(z.string(), paramValueSchema),
  seriesIndex: z.number().int().min(1).max(99).nullable().optional(),
  seriesTotal: z.number().int().min(1).max(99).nullable().optional(),
  cost: z.number().int().min(0).max(100_000_000).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export async function createCareRecordAction(
  input: unknown
): Promise<ActionResult<Awaited<ReturnType<typeof createCareRecord>>>> {
  await requireUser();
  try {
    const parsed = createSchema.parse(input);
    const record = await createCareRecord(parsed);
    return { ok: true, data: record };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: '입력값을 확인하세요', code: 'validation' };
    }
    return toResult(err);
  }
}

const patchSchema = createSchema.partial();

export async function updateCareRecordAction(
  id: number,
  patch: unknown
): Promise<ActionResult<Awaited<ReturnType<typeof updateCareRecord>>>> {
  await requireUser();
  try {
    const parsed = patchSchema.parse(patch);
    const record = await updateCareRecord(idSchema.parse(id), parsed);
    return { ok: true, data: record };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: '입력값을 확인하세요', code: 'validation' };
    }
    return toResult(err);
  }
}

export async function deleteCareRecordAction(id: number): Promise<ActionResult<null>> {
  await requireUser();
  try {
    await deleteCareRecord(idSchema.parse(id));
    return { ok: true, data: null };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: '입력값을 확인하세요', code: 'validation' };
    }
    return toResult(err);
  }
}
