import { describe, expect, it, vi } from 'vitest';
import { runDigest, type DigestRepo } from './digest';
import type { CalendarEvent, Deadline, ReviewJob, Task } from '@/lib/types';

const TODAY = '2026-09-26';

function fakeRepo(overrides: Partial<DigestRepo> = {}): DigestRepo {
  const meta = new Map<string, unknown>();
  return {
    listTasks: async () => [] as Task[],
    listDeadlines: async () => [] as Deadline[],
    listReviews: async () => [] as ReviewJob[],
    getStatusSnapshot: async () => null,
    listCalendarEvents: async () => [] as CalendarEvent[],
    getMeta: async <T>(key: string) => (meta.has(key) ? (meta.get(key) as T) : null),
    setMeta: async (key: string, value: unknown) => {
      meta.set(key, value);
    },
    ...overrides,
  };
}

function deadline(overrides: Partial<Deadline>): Deadline {
  return {
    id: 'd1',
    title: 'test deadline',
    kind: 'other',
    dueDate: '2026-09-27',
    dueTime: null,
    projectId: null,
    paperId: null,
    reviewId: null,
    done: false,
    remindDays: [7, 3, 1],
    updatedAt: TODAY,
    ...overrides,
  };
}

describe('runDigest', () => {
  it('skips (empty) when there is nothing to report and does not write lastSent', async () => {
    const repo = fakeRepo();
    const sender = vi.fn(async () => ({ ok: true }));

    const result = await runDigest(repo, sender, TODAY, false, null);

    expect(result).toBe('skipped-empty');
    expect(sender).not.toHaveBeenCalled();
    expect(await repo.getMeta('telegram:digest:lastSent')).toBeNull();
  });

  it('sends and records lastSent when there is something to report', async () => {
    const repo = fakeRepo({ listDeadlines: async () => [deadline({ dueDate: '2026-09-27' })] }); // dday 1
    const sender = vi.fn(async () => ({ ok: true }));

    const result = await runDigest(repo, sender, TODAY, false, null);

    expect(result).toBe('sent');
    expect(sender).toHaveBeenCalledTimes(1);
    expect(await repo.getMeta('telegram:digest:lastSent')).toBe(TODAY);
  });

  it('skips (already sent) once per day unless forced', async () => {
    const repo = fakeRepo({ listDeadlines: async () => [deadline({ dueDate: '2026-09-27' })] });
    const sender = vi.fn(async () => ({ ok: true }));

    await runDigest(repo, sender, TODAY, false, null);
    const second = await runDigest(repo, sender, TODAY, false, null);

    expect(second).toBe('skipped-already');
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('force bypasses the once-per-day guard', async () => {
    const repo = fakeRepo({ listDeadlines: async () => [deadline({ dueDate: '2026-09-27' })] });
    const sender = vi.fn(async () => ({ ok: true }));

    await runDigest(repo, sender, TODAY, false, null);
    const forced = await runDigest(repo, sender, TODAY, true, null);

    expect(forced).toBe('sent');
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('reports failed and does not record lastSent when the sender fails', async () => {
    const repo = fakeRepo({ listDeadlines: async () => [deadline({ dueDate: '2026-09-27' })] });
    const sender = vi.fn(async () => ({ ok: false, error: 'boom' }));

    const result = await runDigest(repo, sender, TODAY, false, null);

    expect(result).toBe('failed');
    expect(await repo.getMeta('telegram:digest:lastSent')).toBeNull();
  });
});
