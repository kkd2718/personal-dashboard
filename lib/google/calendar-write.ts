// Orchestration for /cal: insert into Google, then drop an optimistic row into the
// dashboard so the event shows immediately (docs/PLAN_AX.md §5).
import { addDaysStr, todayKST } from '@/lib/logic/dates';
import type { Repo } from '@/lib/repo';
import {
  insertCalendarEvent,
  optimisticCalendarEvent,
  type GoogleCalendarConfig,
  type NewEvent,
} from './calendar';

export const GOOGLE_AUTH_EXPIRED = '구글 인증 만료 — scripts/google-oauth.mjs 다시 실행';

export async function createCalendarEvents(
  repo: Pick<Repo, 'listCalendarEvents' | 'upsertCalendarEvent'>,
  cfg: GoogleCalendarConfig,
  events: NewEvent[],
  fetchImpl: typeof fetch = fetch
): Promise<{ created: NewEvent[]; error: string | null }> {
  const created: NewEvent[] = [];
  const seg = cfg.calendarId === 'primary' ? 'primary' : cfg.calendarId;
  let knownName: string | null | undefined; // undefined = not looked up yet

  for (const ev of events) {
    const res = await insertCalendarEvent(cfg, ev, fetchImpl);
    if (!res.ok) {
      return { created, error: res.error === 'invalid_grant' ? GOOGLE_AUTH_EXPIRED : '구글 캘린더에 추가하지 못했어요' };
    }
    created.push(ev);
    if (!cfg.account) continue;
    try {
      if (knownName === undefined) {
        const today = todayKST();
        const rows = await repo.listCalendarEvents(addDaysStr(today, -7), addDaysStr(today, 60));
        knownName = rows.find((r) => r.account === cfg.account && r.id.split(':')[1] === seg)?.calendarName ?? null;
      }
      const name = knownName ?? res.value.organizerEmail ?? 'Google';
      await repo.upsertCalendarEvent(
        optimisticCalendarEvent(cfg.account, seg, name, res.value.eventId, ev, new Date().toISOString())
      );
    } catch {
      // the event already exists in Google; the hourly sync will mirror it
    }
  }
  return { created, error: null };
}
