import { describe, expect, it } from 'vitest';
import { checklistLine, checklistSummary, isStatusStale, meChecklistDue, projectDetailMetaKey, statusAgeLabel } from './project-detail';
import type { CcChecklistItem, CcStatus } from '@/lib/types';

const status = (updatedAt: string | null): CcStatus => ({ updatedAt, focus: null, next: [], blockers: [], done: [], checklist: [] });

function item(overrides: Partial<CcChecklistItem>): CcChecklistItem {
  return { text: 't', status: 'todo', section: null, owner: 'me', ...overrides };
}

function withChecklist(checklist: CcChecklistItem[]): CcStatus {
  return { ...status(null), checklist };
}

describe('projectDetailMetaKey', () => {
  it('namespaces by project id', () => {
    expect(projectDetailMetaKey('amgi')).toBe('project:detail:amgi');
  });
});

describe('statusAgeLabel', () => {
  it('renders a relative label when updatedAt is present', () => {
    expect(statusAgeLabel(status('2026-09-27T09:00:00.000Z'), '2026-09-27T12:00:00.000Z')).toBe('3시간 전 기록');
  });

  it('returns null when status or updatedAt is missing', () => {
    expect(statusAgeLabel(null, '2026-09-27T12:00:00.000Z')).toBeNull();
    expect(statusAgeLabel(status(null), '2026-09-27T12:00:00.000Z')).toBeNull();
  });
});

describe('isStatusStale', () => {
  const now = new Date('2026-09-27T12:00:00.000Z').getTime();

  it('is false within the window', () => {
    expect(isStatusStale(status('2026-09-25T12:00:00.000Z'), now)).toBe(false);
  });

  it('is true beyond the window (default 7 days)', () => {
    expect(isStatusStale(status('2026-09-01T12:00:00.000Z'), now)).toBe(true);
  });

  it('respects a custom days threshold', () => {
    const status5DaysOld = status('2026-09-22T12:00:00.000Z');
    expect(isStatusStale(status5DaysOld, now, 3)).toBe(true);
    expect(isStatusStale(status5DaysOld, now, 7)).toBe(false);
  });

  it('is true when status or updatedAt is missing', () => {
    expect(isStatusStale(null, now)).toBe(true);
    expect(isStatusStale(status(null), now)).toBe(true);
  });
});

describe('checklistSummary', () => {
  const today = '2026-09-28';

  it('returns null when there is no status or no checklist', () => {
    expect(checklistSummary(null, today)).toBeNull();
    expect(checklistSummary(status(null), today)).toBeNull();
  });

  it('lists doing items in order and counts open/blocked/meOpen', () => {
    const checklist = [
      item({ text: 'a', status: 'doing' }),
      item({ text: 'b', status: 'doing', owner: 'agent' }),
      item({ text: 'c', status: 'blocked', owner: 'me' }),
      item({ text: 'd', status: 'done', owner: 'me' }),
      item({ text: 'e', status: 'todo', owner: 'agent' }),
    ];
    expect(checklistSummary(withChecklist(checklist), today)).toEqual({
      doing: ['a', 'b'],
      meOpen: 2, // 'a' (doing) and 'c' (blocked counts as open), both owner 'me'
      open: 4, // everything but the done item
      total: 5,
      blocked: 1,
      nextDue: null,
    });
  });

  it('picks the earliest due item on or after today, else the earliest overdue one', () => {
    const future = [
      item({ text: 'later', status: 'todo', due: '2026-10-05' }),
      item({ text: 'sooner', status: 'todo', due: '2026-09-30' }),
    ];
    expect(checklistSummary(withChecklist(future), today)?.nextDue).toEqual({ text: 'sooner', due: '2026-09-30' });

    const overdue = [
      item({ text: 'very late', status: 'todo', due: '2026-09-01' }),
      item({ text: 'less late', status: 'todo', due: '2026-09-20' }),
    ];
    // no item due on/after today: falls back to the earliest overall (plan: "overdue first is fine").
    expect(checklistSummary(withChecklist(overdue), today)?.nextDue).toEqual({ text: 'very late', due: '2026-09-01' });
  });

  it('ignores done items and items without a due date for nextDue', () => {
    const checklist = [item({ text: 'no due', status: 'todo' }), item({ text: 'done', status: 'done', due: '2026-09-29' })];
    expect(checklistSummary(withChecklist(checklist), today)?.nextDue).toBeNull();
  });
});

describe('checklistLine', () => {
  it('leads with the first doing item, appending a count for extras', () => {
    expect(checklistLine({ doing: ['a'], meOpen: 0, open: 1, total: 3, blocked: 0, nextDue: null })).toBe('진행 중: a');
    expect(checklistLine({ doing: ['a', 'b'], meOpen: 0, open: 2, total: 3, blocked: 0, nextDue: null })).toBe('진행 중: a 외 1');
  });

  it('falls back to nextDue, then to open/total, appending meOpen when > 0', () => {
    expect(
      checklistLine({ doing: [], meOpen: 0, open: 2, total: 3, blocked: 0, nextDue: { text: '제출', due: '2026-10-05' } })
    ).toBe('다음 마감 10/5 제출');
    expect(checklistLine({ doing: [], meOpen: 0, open: 2, total: 3, blocked: 0, nextDue: null })).toBe('남은 2/3');
    expect(checklistLine({ doing: [], meOpen: 2, open: 2, total: 3, blocked: 0, nextDue: null })).toBe('남은 2/3 · 내 할 일 2');
  });
});

describe('meChecklistDue', () => {
  const st = (checklist: CcStatus['checklist']): CcStatus =>
    ({ updatedAt: '2026-09-30T08:00:00+09:00', focus: null, next: [], blockers: [], done: [], checklist }) as CcStatus;

  it('buckets my open dated items into overdue/today/tomorrow and strips the repo suffix', () => {
    const out = meChecklistDue(
      [
        {
          projectName: 'trading-system (kis)',
          status: st([
            item({ text: 'RP 해지', status: 'todo', owner: 'me', due: '2026-09-30' }),
            item({ text: 'IB+VR 시작', status: 'todo', owner: 'me', due: '2026-10-01' }),
            item({ text: '예탁금 문의', status: 'blocked', owner: 'me', due: '2026-09-28' }),
            item({ text: '오래된 일', status: 'todo', owner: 'me', due: '2026-08-01' }),
            item({ text: '에이전트 일', status: 'todo', owner: 'agent', due: '2026-09-30' }),
            item({ text: '끝난 일', status: 'done', owner: 'me', due: '2026-09-30' }),
            item({ text: '기한 없음', status: 'todo', owner: 'me' }),
          ]),
        },
        { projectName: 'Empty', status: null },
      ],
      '2026-09-30'
    );
    expect(out.today).toEqual([{ project: 'trading-system', text: 'RP 해지', due: '2026-09-30', blocked: false }]);
    expect(out.tomorrow.map((i) => i.text)).toEqual(['IB+VR 시작']);
    expect(out.overdue).toEqual([{ project: 'trading-system', text: '예탁금 문의', due: '2026-09-28', blocked: true }]);
  });
});
