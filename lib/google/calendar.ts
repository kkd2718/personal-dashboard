// Server-only Google Calendar write client (docs/PLAN_AX.md §5). Reading calendars
// stays on the Apps Script sync; this is only the immediate-insert path used by
// Telegram's /cal. Never logs tokens, response bodies, or event titles.
if (typeof window !== 'undefined') {
  throw new Error('lib/google/calendar.ts is server-only');
}

import { addDaysStr } from '@/lib/logic/dates';
import { addMinutesKst, type KoDateTime } from '@/lib/logic/ko-datetime';
import type { CalendarEvent } from '@/lib/types';

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
  account: string | null;
}

/** Any of the three OAuth vars missing -> null (/cal then falls back to a memo). */
export function googleCalendarConfig(env: Record<string, string | undefined> = process.env): GoogleCalendarConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    calendarId: env.GOOGLE_CALENDAR_ID || 'primary',
    account: env.GOOGLE_OAUTH_ACCOUNT || null,
  };
}

/** Single-day event; null times = all-day. */
export interface NewEvent {
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
}

const REMINDERS = { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] };

export function buildEventBody(ev: NewEvent): Record<string, unknown> {
  if (ev.startTime === null || ev.endTime === null) {
    return { summary: ev.title, start: { date: ev.date }, end: { date: addDaysStr(ev.date, 1) }, reminders: REMINDERS };
  }
  return {
    summary: ev.title,
    start: { dateTime: `${ev.date}T${ev.startTime}:00`, timeZone: 'Asia/Seoul' },
    end: { dateTime: `${ev.date}T${ev.endTime}:00`, timeZone: 'Asia/Seoul' },
    reminders: REMINDERS,
  };
}

export type CalResult<T> = { ok: true; value: T } | { ok: false; error: 'invalid_grant' | 'http' | 'network' };

let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

/** Test hook: drops the module-level access-token cache. */
export function resetAccessTokenCache(): void {
  tokenCache = null;
}

export async function getAccessToken(
  cfg: GoogleCalendarConfig,
  fetchImpl: typeof fetch = fetch
): Promise<CalResult<string>> {
  const key = `${cfg.clientId}:${cfg.refreshToken}`;
  if (tokenCache && tokenCache.key === key && Date.now() < tokenCache.expiresAt) {
    return { ok: true, value: tokenCache.token };
  }
  let res: Response;
  try {
    res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { ok: false, error: 'network' };
  }
  let json: { access_token?: unknown; expires_in?: unknown; error?: unknown } | null = null;
  try {
    json = await res.json();
  } catch {
    // fall through to the status check
  }
  if (!res.ok) return { ok: false, error: json?.error === 'invalid_grant' ? 'invalid_grant' : 'http' };
  if (typeof json?.access_token !== 'string') return { ok: false, error: 'http' };
  const ttl = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  tokenCache = { key, token: json.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  return { ok: true, value: json.access_token };
}

export async function insertCalendarEvent(
  cfg: GoogleCalendarConfig,
  ev: NewEvent,
  fetchImpl: typeof fetch = fetch
): Promise<CalResult<{ eventId: string; organizerEmail: string | null }>> {
  const token = await getAccessToken(cfg, fetchImpl);
  if (!token.ok) return token;
  try {
    const res = await fetchImpl(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token.value}` },
        body: JSON.stringify(buildEventBody(ev)),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return { ok: false, error: 'http' };
    const json = (await res.json()) as { id?: unknown; organizer?: { email?: unknown } };
    if (typeof json.id !== 'string') return { ok: false, error: 'http' };
    const email = json.organizer?.email;
    return { ok: true, value: { eventId: json.id, organizerEmail: typeof email === 'string' ? email : null } };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** The row shown on the dashboard until the next Apps Script sync replaces it. */
export function optimisticCalendarEvent(
  account: string,
  calendarSegment: string,
  calendarName: string,
  googleEventId: string,
  ev: NewEvent,
  now: string
): CalendarEvent {
  const startInstant = new Date(`${ev.date}T${ev.startTime ?? '00:00'}:00+09:00`).toISOString();
  return {
    id: `${account}:${calendarSegment}:${googleEventId}:${startInstant}`,
    account,
    calendarName,
    title: ev.title,
    startDate: ev.date,
    endDate: ev.date,
    startTime: ev.startTime,
    endTime: ev.endTime,
    location: null,
    updatedAt: now,
  };
}

/** Turns a parsed phrase into events (titles left empty for the caller). */
export function eventsFromParsed(p: KoDateTime, today: string, nowTime: string): NewEvent[] | { error: string } {
  const first = p.range?.start ?? p.times[0] ?? null;
  if (!p.date && first === null) return { error: '날짜를 찾지 못했어요' };
  const date = p.date ?? (first !== null && first > nowTime ? today : addDaysStr(today, 1));
  if (p.range) return [{ title: '', date, startTime: p.range.start, endTime: p.range.end }];
  if (p.times.length === 0) return [{ title: '', date, startTime: null, endTime: null }];
  return p.times.slice(0, 5).map((t) => {
    const end = addMinutesKst(date, t, p.durationMin ?? 60);
    return { title: '', date, startTime: t, endTime: end.date === date ? end.time : '23:59' };
  });
}
