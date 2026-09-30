import { describe, expect, it, vi } from 'vitest';
import { runEvening, type EveningRepo } from './evening';
import { formatDigest, formatToday, route } from './format';
import { routineStatus, SEED_ROUTINES, type RoutineItem } from '@/lib/logic/routines';

const TODAY = '2026-10-02';

function fakeRepo(initial: Record<string, unknown> = {}): EveningRepo & { meta: Map<string, unknown> } {
  const meta = new Map<string, unknown>(Object.entries(initial));
  return {
    meta,
    getMeta: async <T>(key: string) => (meta.has(key) ? (meta.get(key) as T) : null),
    setMeta: async (key, value) => {
      meta.set(key, value);
    },
  };
}

const ok = () => vi.fn(async (_text: string) => ({ ok: true }));

describe('runEvening', () => {
  it('sends only the not-yet-done routines, with a /done hint, and records lastSent', async () => {
    const repo = fakeRepo({ [`routine:done:${TODAY}`]: ['allen-daily'] });
    const sender = ok();
    expect(await runEvening(repo, sender, TODAY, false)).toBe('sent');
    const text = sender.mock.calls[0][0];
    expect(text).toContain('🌙 저녁 체크');
    expect(text).toContain('암기 오늘의 공부');
    expect(text).not.toContain('알렌');
    expect(text).toContain('/done 1');
    expect(repo.meta.get('telegram:evening:lastSent')).toBe(TODAY);
  });

  it('sends nothing but records lastSent when every routine is done', async () => {
    const repo = fakeRepo({ [`routine:done:${TODAY}`]: ['allen-daily', 'amgi-daily'] });
    const sender = ok();
    expect(await runEvening(repo, sender, TODAY, false)).toBe('skipped-done');
    expect(sender).not.toHaveBeenCalled();
    expect(repo.meta.get('telegram:evening:lastSent')).toBe(TODAY);
  });

  it('sends nothing when no routine is active (before the start date)', async () => {
    const repo = fakeRepo();
    const sender = ok();
    expect(await runEvening(repo, sender, '2026-09-30', false)).toBe('skipped-none');
    expect(sender).not.toHaveBeenCalled();
    expect(repo.meta.has('telegram:evening:lastSent')).toBe(false);
  });

  it('runs once per day unless forced', async () => {
    const repo = fakeRepo();
    const sender = ok();
    await runEvening(repo, sender, TODAY, false);
    expect(await runEvening(repo, sender, TODAY, false)).toBe('skipped-already');
    expect(await runEvening(repo, sender, TODAY, true)).toBe('sent');
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('reports failed and does not record lastSent when the sender fails', async () => {
    const repo = fakeRepo();
    const sender = vi.fn(async (_text: string) => ({ ok: false, error: 'boom' }));
    expect(await runEvening(repo, sender, TODAY, false)).toBe('failed');
    expect(repo.meta.has('telegram:evening:lastSent')).toBe(false);
  });

  it('links and escapes labels', async () => {
    const items: RoutineItem[] = [
      { id: 'x', label: 'A & B', url: 'https://e.com/?a=1&b="2"', startDate: '2026-10-01', endDate: null, sort: 0 },
    ];
    const repo = fakeRepo({ 'routine:items': items });
    const sender = ok();
    await runEvening(repo, sender, TODAY, false);
    expect(sender.mock.calls[0][0]).toContain('<a href="https://e.com/?a=1&amp;b=&quot;2&quot;">A &amp; B</a>');
  });
});

describe('digest / today routines', () => {
  const rows = routineStatus(SEED_ROUTINES, ['amgi-daily'], TODAY);
  const base = { today: TODAY, deadlines: [], reviews: [], statusItems: [] };
  const emptyCl = { overdue: [], today: [], thisWeek: [], doing: [], next: [] };

  it('digest includes routines right after the header and is sent even when nothing else is due', () => {
    const msg = formatDigest({ ...base, checklist: emptyCl, routines: rows });
    expect(msg).not.toBeNull();
    const lines = msg!.split('\n');
    expect(lines[0]).toContain('브리핑');
    expect(lines.indexOf('<b>🔁 오늘 루틴</b>')).toBe(2);
    expect(msg).toContain('• 알렌의 서재 오늘의 문제');
    expect(formatDigest({ ...base, checklist: emptyCl, routines: [] })).toBeNull();
  });

  it('/today shows done state', () => {
    const msg = formatToday({ ...base, checklist: emptyCl, upcoming: [], dayMemos: [], routines: rows });
    expect(msg).toContain('⬜ 알렌의 서재 오늘의 문제');
    expect(msg).toContain('✅ 암기 오늘의 공부');
  });
});

describe('route /done', () => {
  it('parses the command and its argument', () => {
    expect(route('/done 1')).toEqual({ kind: 'command', name: 'done', arg: '1' });
    expect(route('/done@my_bot 알렌')).toEqual({ kind: 'command', name: 'done', arg: '알렌' });
    expect(route('/done')).toEqual({ kind: 'command', name: 'done', arg: '' });
  });
});
