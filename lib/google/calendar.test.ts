import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPrimaryCalendarEvent } from '@/lib/logic/calendar';
import { parseKoDateTime } from '@/lib/logic/ko-datetime';
import type { CalendarEvent } from '@/lib/types';
import {
  buildEventBody,
  eventsFromParsed,
  getAccessToken,
  googleCalendarConfig,
  insertCalendarEvent,
  optimisticCalendarEvent,
  resetAccessTokenCache,
  type GoogleCalendarConfig,
} from './calendar';
import { createCalendarEvents } from './calendar-write';

const cfg: GoogleCalendarConfig = {
  clientId: 'cid',
  clientSecret: 'sec',
  refreshToken: 'rt',
  calendarId: 'primary',
  account: null,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const dentist = { title: '치과', date: '2026-10-16', startTime: '14:00', endTime: '15:00' };

beforeEach(() => resetAccessTokenCache());

describe('buildEventBody', () => {
  it('timed', () => {
    expect(buildEventBody(dentist)).toEqual({
      summary: '치과',
      start: { dateTime: '2026-10-16T14:00:00', timeZone: 'Asia/Seoul' },
      end: { dateTime: '2026-10-16T15:00:00', timeZone: 'Asia/Seoul' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
    });
  });

  it('all-day end is exclusive', () => {
    const body = buildEventBody({ title: 'x', date: '2026-10-31', startTime: null, endTime: null }) as {
      start: unknown;
      end: unknown;
    };
    expect(body.start).toEqual({ date: '2026-10-31' });
    expect(body.end).toEqual({ date: '2026-11-01' });
  });
});

describe('googleCalendarConfig', () => {
  it('null without the three OAuth vars', () => {
    expect(googleCalendarConfig({})).toBeNull();
    expect(googleCalendarConfig({ GOOGLE_OAUTH_CLIENT_ID: 'a', GOOGLE_OAUTH_CLIENT_SECRET: 'b' })).toBeNull();
  });
  it('defaults', () => {
    const c = googleCalendarConfig({
      GOOGLE_OAUTH_CLIENT_ID: 'a',
      GOOGLE_OAUTH_CLIENT_SECRET: 'b',
      GOOGLE_OAUTH_REFRESH_TOKEN: 'c',
    });
    expect(c).toMatchObject({ calendarId: 'primary', account: null });
  });
});

describe('getAccessToken', () => {
  it('caches a good token', async () => {
    const f = vi.fn(async () => json({ access_token: 'tok', expires_in: 3600 }));
    expect(await getAccessToken(cfg, f as unknown as typeof fetch)).toEqual({ ok: true, value: 'tok' });
    expect(await getAccessToken(cfg, f as unknown as typeof fetch)).toEqual({ ok: true, value: 'tok' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('invalid_grant', async () => {
    const f = async () => json({ error: 'invalid_grant' }, 400);
    expect(await getAccessToken(cfg, f as unknown as typeof fetch)).toEqual({ ok: false, error: 'invalid_grant' });
  });

  it('network error', async () => {
    const f = async () => {
      throw new Error('boom');
    };
    expect(await getAccessToken(cfg, f as unknown as typeof fetch)).toEqual({ ok: false, error: 'network' });
  });
});

describe('insertCalendarEvent', () => {
  it('posts with a bearer token and maps the response', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('oauth2')) return json({ access_token: 'tok', expires_in: 3600 });
      return json({ id: 'abc', organizer: { email: 'x@example.com' } });
    };
    const res = await insertCalendarEvent(cfg, dentist, f as unknown as typeof fetch);
    expect(res).toEqual({ ok: true, value: { eventId: 'abc', organizerEmail: 'x@example.com' } });
    const insert = calls[1];
    expect(insert.url).toContain('/calendars/primary/events');
    expect((insert.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });
});

describe('optimisticCalendarEvent', () => {
  it('builds an id the primary-calendar rule recognises', () => {
    const e = optimisticCalendarEvent('main', 'primary', 'Cal', 'abc', dentist, '2026-10-15T00:00:00.000Z');
    expect(e.id).toBe('main:primary:abc:2026-10-16T05:00:00.000Z');
    expect(e.startTime).toBe('14:00');
    expect(isPrimaryCalendarEvent(e)).toBe(true);
  });
});

describe('eventsFromParsed', () => {
  const today = '2026-10-15';
  const ev = (text: string, now = '10:00') => eventsFromParsed(parseKoDateTime(text, today), today, now);

  it('two bare times become two events', () => {
    expect(ev('다음주 화요일 2시 3시')).toEqual([
      { title: '', date: '2026-10-20', startTime: '14:00', endTime: '15:00' },
      { title: '', date: '2026-10-20', startTime: '15:00', endTime: '16:00' },
    ]);
  });
  it('a range is one event', () => {
    expect(ev('내일 2시~3시')).toEqual([{ title: '', date: '2026-10-16', startTime: '14:00', endTime: '15:00' }]);
  });
  it('time only rolls to tomorrow when already past', () => {
    expect(ev('15:00', '16:00')).toEqual([{ title: '', date: '2026-10-16', startTime: '15:00', endTime: '16:00' }]);
    expect(ev('15:00', '10:00')).toEqual([{ title: '', date: '2026-10-15', startTime: '15:00', endTime: '16:00' }]);
  });
  it('date only is all-day', () => {
    expect(ev('내일')).toEqual([{ title: '', date: '2026-10-16', startTime: null, endTime: null }]);
  });
  it('clamps an event running past midnight', () => {
    expect(ev('내일 11:30 2시간')).toEqual([{ title: '', date: '2026-10-16', startTime: '11:30', endTime: '13:30' }]);
    expect(ev('내일 23:30')).toEqual([{ title: '', date: '2026-10-16', startTime: '23:30', endTime: '23:59' }]);
  });
  it('nothing parsed is an error', () => {
    expect(ev('치과')).toEqual({ error: '날짜를 찾지 못했어요' });
  });
});

describe('createCalendarEvents', () => {
  it('inserts, adds an optimistic row when an account is set', async () => {
    const upserted: CalendarEvent[] = [];
    const repo = {
      listCalendarEvents: async () => [] as CalendarEvent[],
      upsertCalendarEvent: async (e: CalendarEvent) => void upserted.push(e),
    };
    const f = async (url: string) =>
      url.includes('oauth2') ? json({ access_token: 't', expires_in: 3600 }) : json({ id: 'e1', organizer: { email: 'o@example.com' } });
    const out = await createCalendarEvents(repo, { ...cfg, account: 'main' }, [dentist], f as unknown as typeof fetch);
    expect(out).toEqual({ created: [dentist], error: null });
    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toMatchObject({ account: 'main', calendarName: 'o@example.com', title: '치과' });
  });

  it('reports expired auth', async () => {
    const repo = { listCalendarEvents: async () => [], upsertCalendarEvent: async () => {} };
    const f = async () => json({ error: 'invalid_grant' }, 400);
    const out = await createCalendarEvents(repo, cfg, [dentist], f as unknown as typeof fetch);
    expect(out.created).toEqual([]);
    expect(out.error).toContain('google-oauth.mjs');
  });
});

describe('LocalRepo calendar upsert + deleteMeta', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'cc-localrepo-'));
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('upsert is idempotent and replaceCalendarEvents clears it', async () => {
    const { LocalRepo } = await import('@/lib/repo/local');
    const repo = new LocalRepo();
    const e = optimisticCalendarEvent('main', 'primary', 'Cal', 'abc', dentist, '2026-10-15T00:00:00.000Z');
    await repo.upsertCalendarEvent(e);
    await repo.upsertCalendarEvent({ ...e, title: '치과2' });
    const rows = await repo.listCalendarEvents('2026-10-16', '2026-10-16');
    expect(rows.filter((r) => r.id === e.id)).toHaveLength(1);
    expect(rows.find((r) => r.id === e.id)?.title).toBe('치과2');

    await repo.replaceCalendarEvents('main', '2026-10-09', '2026-12-14', []);
    const after = await repo.listCalendarEvents('2026-10-16', '2026-10-16');
    expect(after.some((r) => r.id === e.id)).toBe(false);
  });

  it('claimMeta is insert-if-absent', async () => {
    const { LocalRepo } = await import('@/lib/repo/local');
    const repo = new LocalRepo();
    expect(await repo.claimMeta('c', 'first')).toBe(true);
    expect(await repo.claimMeta('c', 'second')).toBe(false);
    expect(await repo.getMeta('c')).toBe('first');
  });

  it('deleteMeta removes the key', async () => {
    const { LocalRepo } = await import('@/lib/repo/local');
    const repo = new LocalRepo();
    await repo.setMeta('k', { a: 1 });
    await repo.deleteMeta('k');
    expect(await repo.getMeta('k')).toBeNull();
    await repo.deleteMeta('k'); // absent: no-op
  });
});
