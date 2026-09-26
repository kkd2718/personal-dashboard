'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import { revalidateAll } from '@/app/actions/revalidate';
import { requireUser } from '@/lib/auth/require-user';
import { CALENDAR_VISIBLE_META_KEY } from '@/lib/logic/calendar';

/** Persists the set of Google calendar_names currently toggled visible (Addendum
 * A §3) — server-side (app_meta), not localStorage, so /today + the daily digest
 * respect it too. */
export async function setVisibleCalendarsAction(names: string[]): Promise<void> {
  await requireUser();
  const parsed = z.array(z.string().min(1)).parse(names);
  await getRepo().setMeta(CALENDAR_VISIBLE_META_KEY, parsed);
  revalidateAll();
}
