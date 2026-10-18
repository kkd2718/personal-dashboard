import { beforeEach, describe, expect, it, vi } from 'vitest';
import { project } from '@/lib/logic/ax-fixtures';
import { resetAccessTokenCache, type GoogleCalendarConfig } from '@/lib/google/calendar';
import type { CalendarEvent, Note, ProjectActivity } from '@/lib/types';
import { handleCallback, type AxDeps } from './ax';
import { handleRemind, handleReminds, handleSend } from './send-remind';

const NOW = new Date('2026-11-07T03:00:00.000Z'); // 2026-11-07 (Sat) 12:00 KST
const projects = [
  project({ id: 'p1', slug: 'brainct', name: 'BrainCT' }),
  project({ id: 'p2', slug: 'amgi', name: 'Amgi' }),
];
const CFG: GoogleCalendarConfig = { clientId: 'c', clientSecret: 's', refreshToken: 'r', calendarId: 'primary', account: 'me' };

function setup(over: { cfg?: GoogleCalendarConfig | null; activity?: ProjectActivity[]; events?: CalendarEvent[] } = {}) {
  const meta = new Map<string, unknown>();
  const notes: Note[] = [];
  const events: CalendarEvent[] = [...(over.events ?? [])];
  let seq = 0;
  const repo = {
    listProjects: async () => projects,
    listProjectActivity: async () => over.activity ?? [],
    listNotes: async () => notes.map((n) => ({ ...n })),
    createNote: async (i: { body: string; kind: Note['kind']; projectId?: string | null }) => {
      const n = { id: `n${++seq}`, body: i.body, kind: i.kind, projectId: i.projectId ?? null, status: 'inbox', deliveredAt: null, tags: [], source: 'telegram' } as unknown as Note;
      notes.push(n);
      return n;
    },
    updateNote: async (id: string, patch: Partial<Note>) => {
      Object.assign(notes.find((n) => n.id === id)!, patch);
      return notes.find((n) => n.id === id)!;
    },
    listCalendarEvents: async (from: string, to: string) => events.filter((e) => e.startDate <= to && e.endDate >= from),
    upsertCalendarEvent: async (e: CalendarEvent) => void events.push(e),
    replaceCalendarEvents: async (account: string, from: string, to: string, list: CalendarEvent[]) => {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].account === account && events[i].startDate <= to && events[i].endDate >= from) events.splice(i, 1);
      events.push(...list);
    },
    getMeta: async (k: string) => (meta.has(k) ? structuredClone(meta.get(k)) : null),
    setMeta: async (k: string, v: unknown) => void meta.set(k, structuredClone(v)),
    listMetaByPrefix: async (p: string) => Object.fromEntries([...meta].filter(([k]) => k.startsWith(p))),
    deleteMeta: async (k: string) => void meta.delete(k),
    claimMeta: async (k: string, v: unknown) => (meta.has(k) ? false : (meta.set(k, v), true)),
  };
  const sends: Array<{ text: string; markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }> = [];
  const edits: Array<{ text: string; markup?: unknown }> = [];
  const answers: Array<string | undefined> = [];
  const requests: Array<{ method: string; url: string; body: Record<string, unknown> | null }> = [];
  let deleteStatus = 204;
  const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
    if (url.includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    requests.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body) : null });
    if (init?.method === 'DELETE') return new Response(null, { status: deleteStatus });
    return new Response(JSON.stringify({ id: 'evt123abc', organizer: { email: 'me@x.com' } }));
  }) as unknown as typeof fetch;
  const deps = {
    repo,
    jev: null,
    send: async (t: string) => void sends.push({ text: t }),
    sendWithMarkup: async (t: string, markup: never) => (sends.push({ text: t, markup }), { ok: true }),
    edit: async (_id: number, t: string, markup?: unknown) => void edits.push({ text: t, markup }),
    answer: async (_id: string, t?: string) => void answers.push(t),
    createNote: vi.fn(async (t: string) => repo.createNote({ body: t, kind: 'memo' })),
    calendarCfg: over.cfg === undefined ? CFG : over.cfg,
    now: () => NOW,
    fetchImpl,
  } as unknown as AxDeps;
  const press = (data: string) => handleCallback(deps, { callbackId: 'cb', messageId: 7, data });
  return { deps, notes, events, meta, sends, edits, answers, requests, press, setDeleteStatus: (s: number) => (deleteStatus = s) };
}

beforeEach(() => resetAccessTokenCache());

describe('/send', () => {
  it('known project: creates the sent memo immediately and offers a cancel button', async () => {
    const s = setup();
    await handleSend(s.deps, '@brainct 리뷰어 답변 반영해줘', null);
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]).toMatchObject({ projectId: 'p1', status: 'sent', body: '[텔레그램 /send] 리뷰어 답변 반영해줘' });
    expect(s.sends[0].text).toBe('📨 BrainCT 세션에 전달 예약됨 — 다음 세션 입력 때 들어가요');
    expect(s.sends[0].markup?.inline_keyboard[0][0].text).toBe('취소');
  });

  it('cancel before delivery archives the memo; a second tap is a no-op', async () => {
    const s = setup();
    await handleSend(s.deps, '@brainct 내용', null);
    const data = s.sends[0].markup!.inline_keyboard[0][0].callback_data;
    await s.press(data);
    expect(s.notes[0].status).toBe('archived');
    expect(s.edits[0].text).toContain('취소했어요');
    await s.press(data);
    expect(s.answers.at(-1)).toBe('이미 처리됨');
  });

  it('cancel after delivery says it is already delivered and keeps the memo', async () => {
    const s = setup();
    await handleSend(s.deps, '@brainct 내용', null);
    s.notes[0].deliveredAt = '2026-11-07T02:00:00.000Z';
    await s.press(s.sends[0].markup!.inline_keyboard[0][0].callback_data);
    expect(s.notes[0].status).toBe('sent');
    expect(s.answers.at(-1)).toBe('이미 전달됨');
    expect(s.edits[0].text).toContain('이미 전달됨');
  });

  it('no or unknown project: keyboard of active projects (recent first), memo created only on press', async () => {
    const activity = [{ projectId: 'p2', lastCommitAt: '2026-11-06T00:00:00Z', collectedAt: '2026-11-06T00:00:00Z' }] as ProjectActivity[];
    const s = setup({ activity });
    await handleSend(s.deps, '@nothing 어떤 내용', null);
    expect(s.notes).toHaveLength(0);
    const kb = s.sends[0].markup!.inline_keyboard.flat();
    expect(kb.map((b) => b.text)).toEqual(['Amgi', 'BrainCT']);
    await s.press(kb[1].callback_data);
    expect(s.notes[0]).toMatchObject({ projectId: 'p1', status: 'sent', body: '[텔레그램 /send] @nothing 어떤 내용' });
    expect(s.edits[0].text).toContain('BrainCT 세션에 전달 예약됨');
    expect(s.edits[0].markup).toBeTruthy(); // cancel button now
    await s.press(kb[1].callback_data);
    expect(s.notes).toHaveLength(1);
  });

  it('reply-to: only @project sends the replied-to message text', async () => {
    const s = setup();
    await handleSend(s.deps, '@amgi', '이건 /ask 답변 본문');
    expect(s.notes[0]).toMatchObject({ projectId: 'p2', body: '[텔레그램 /send] 이건 /ask 답변 본문' });
  });

  it('empty content: usage, nothing created', async () => {
    const s = setup();
    await handleSend(s.deps, '@amgi', null);
    await handleSend(s.deps, '', null);
    expect(s.notes).toHaveLength(0);
    expect(s.sends.map((x) => x.text)).toEqual([expect.stringContaining('사용법'), expect.stringContaining('사용법')]);
  });
});

describe('/remind', () => {
  it('creates a 10 minute timed event whose popup fires at the start; row mirrored; cancel button', async () => {
    const s = setup();
    await handleRemind(s.deps, '내일 오전 9시 약 먹기');
    const post = s.requests.find((r) => r.method === 'POST')!;
    expect(post.body).toEqual({
      summary: '🔔 약 먹기',
      start: { dateTime: '2026-11-08T09:00:00', timeZone: 'Asia/Seoul' },
      end: { dateTime: '2026-11-08T09:10:00', timeZone: 'Asia/Seoul' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    });
    expect(s.sends[0].text).toBe('🔔 11/8(일) 09:00 알림 설정 — 구글 캘린더 알림으로 와요\n약 먹기');
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({ title: '🔔 약 먹기', startDate: '2026-11-08', startTime: '09:00' });
    expect(s.sends[0].markup?.inline_keyboard[0][0].text).toBe('취소');
  });

  it('time-only phrase already passed today: rolls to tomorrow and says so', async () => {
    const s = setup();
    await handleRemind(s.deps, '오전 9시 약 먹기');
    expect(s.requests.find((r) => r.method === 'POST')!.body).toMatchObject({ start: { dateTime: '2026-11-08T09:00:00' } });
    expect(s.sends[0].text).toBe('🔔 내일 11/8(일) 09:00 알림 설정 — 구글 캘린더 알림으로 와요\n약 먹기');
  });

  it('relative time: 30분 뒤', async () => {
    const s = setup();
    await handleRemind(s.deps, '30분 뒤 전화');
    expect(s.requests.find((r) => r.method === 'POST')!.body).toMatchObject({ start: { dateTime: '2026-11-07T12:30:00' } });
  });

  it('past time and usage create nothing', async () => {
    const s = setup();
    await handleRemind(s.deps, '오늘 오전 9시 약');
    await handleRemind(s.deps, '내일 병원');
    await handleRemind(s.deps, '');
    expect(s.requests).toHaveLength(0);
    expect(s.sends.map((x) => x.text)).toEqual(['과거 시각이에요', expect.stringContaining('사용법'), expect.stringContaining('사용법')]);
  });

  it('cancel button deletes the Google event and the mirrored row', async () => {
    const s = setup();
    await handleRemind(s.deps, '내일 오전 9시 약 먹기');
    await s.press(s.sends[0].markup!.inline_keyboard[0][0].callback_data);
    const del = s.requests.find((r) => r.method === 'DELETE')!;
    expect(del.url).toContain('/calendars/primary/events/evt123abc');
    expect(s.events).toHaveLength(0);
    expect(s.edits[0].text).toContain('취소했어요');
  });

  it('cancel button: a Google failure releases the claim so the owner can retry', async () => {
    const s = setup();
    await handleRemind(s.deps, '내일 오전 9시 약 먹기');
    const data = s.sends[0].markup!.inline_keyboard[0][0].callback_data;
    s.setDeleteStatus(500);
    await s.press(data);
    expect(s.events).toHaveLength(1);
    s.setDeleteStatus(204);
    await s.press(data);
    expect(s.events).toHaveLength(0);
  });

  it('without OAuth config: explains and saves a memo', async () => {
    const s = setup({ cfg: null });
    await handleRemind(s.deps, '내일 9시 약');
    expect(s.deps.createNote).toHaveBeenCalledWith('내일 9시 약');
    expect(s.sends[0].text).toContain('메모로 저장했어요');
    expect(s.requests).toHaveLength(0);
  });
});

describe('/reminds and /remind 취소 N', () => {
  const row = (id: string, title: string, startDate: string, startTime: string): CalendarEvent => ({
    id,
    account: 'me',
    calendarName: 'c',
    title,
    startDate,
    endDate: startDate,
    startTime,
    endTime: null,
    location: null,
    updatedAt: '',
  });
  const events = [
    row('me:primary:e2:x', '🔔 둘째', '2026-11-09', '08:00'),
    row('me:primary:e1:x', '🔔 첫째', '2026-11-07', '13:00'),
    row('me:primary:e5:x', '치과', '2026-11-08', '10:00'),
  ];

  it('lists upcoming reminders numbered soonest first', async () => {
    const s = setup({ events });
    await handleReminds(s.deps);
    expect(s.sends[0].text).toContain('1. 11/7(토) 13:00 첫째');
    expect(s.sends[0].text).toContain('2. 11/9(월) 08:00 둘째');
    expect(s.sends[0].text).not.toContain('치과');
  });

  it('empty list message', async () => {
    const s = setup();
    await handleReminds(s.deps);
    expect(s.sends[0].text).toBe('예정된 알림이 없어요');
  });

  it('/remind 취소 2 deletes the second reminder', async () => {
    const s = setup({ events });
    await handleRemind(s.deps, '취소 2');
    expect(s.requests.find((r) => r.method === 'DELETE')!.url).toContain('/events/e2');
    expect(s.events.map((e) => e.id)).toEqual(['me:primary:e1:x', 'me:primary:e5:x']);
    expect(s.sends[0].text).toContain('알림 취소');
  });

  it('unknown number: nothing deleted', async () => {
    const s = setup({ events });
    await handleRemind(s.deps, '취소 9');
    expect(s.requests).toHaveLength(0);
    expect(s.sends[0].text).toContain('번호의 알림이 없어요');
  });
});
