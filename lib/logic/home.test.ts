import { describe, expect, it } from 'vitest';
import {
  deadlineCounts,
  headerCountLabel,
  nextRevisionDeadline,
  paperStageSummary,
  projectActivitySentence,
  sortByRecency,
} from './home';
import type { Deadline, Paper, Project, ProjectActivity } from '@/lib/types';

const today = '2026-09-26'; // Saturday; ISO week ends Sunday 2026-09-27

function deadline(overrides: Partial<Deadline>): Deadline {
  return {
    id: Math.random().toString(36),
    title: 'd',
    kind: 'other',
    dueDate: today,
    dueTime: null,
    projectId: null,
    paperId: null,
    reviewId: null,
    done: false,
    remindDays: [7, 3, 1],
    updatedAt: today,
    ...overrides,
  };
}

describe('deadlineCounts', () => {
  it('buckets overdue/today/thisWeek and skips done', () => {
    const deadlines = [
      deadline({ dueDate: '2026-09-20' }), // overdue
      deadline({ dueDate: today }), // today
      deadline({ dueDate: '2026-09-27' }), // this week (Sunday, week end)
      deadline({ dueDate: '2026-10-05' }), // beyond this week
      deadline({ dueDate: '2026-09-20', done: true }), // ignored
    ];
    expect(deadlineCounts(deadlines, today)).toEqual({ overdue: 1, today: 1, thisWeek: 1 });
  });
});

describe('headerCountLabel', () => {
  it('joins non-zero parts only', () => {
    expect(headerCountLabel({ overdue: 1, today: 0, thisWeek: 2 })).toBe('이번 주 2 · 지남 1');
  });

  it('falls back to a no-deadlines sentence when all zero', () => {
    expect(headerCountLabel({ overdue: 0, today: 0, thisWeek: 0 })).toBe('이번 주 마감 없음');
  });
});

describe('projectActivitySentence', () => {
  const now = '2026-09-26T12:00:00.000Z';

  it('combines session and commit relative time', () => {
    const activity: ProjectActivity = {
      projectId: 'p1',
      branch: null,
      lastCommitAt: '2026-09-23T12:00:00.000Z',
      lastCommitMsg: null,
      dirty: null,
      lastSessionAt: '2026-09-26T11:59:40.000Z',
      memoryDigest: null,
      metrics: {},
      collectedAt: now,
    };
    expect(projectActivitySentence(activity, now)).toBe('방금 세션 · 커밋 3일 전');
  });

  it('returns null when there is no activity data', () => {
    expect(projectActivitySentence(undefined, now)).toBeNull();
  });
});

describe('sortByRecency', () => {
  function project(id: string): Project {
    return {
      id,
      slug: id,
      name: id,
      group: 'app',
      subgroup: null,
      status: 'active',
      summary: '',
      nextAction: null,
      links: [],
      paths: [],
      aliases: [],
      backlogGlobs: [],
      pinned: false,
      sort: 0,
      color: 'blue',
      updatedAt: '',
    };
  }

  it('sorts by most recent session/commit first, unknowns last', () => {
    const a = project('a');
    const b = project('b');
    const c = project('c');
    const map = new Map<string, ProjectActivity>([
      ['a', { projectId: 'a', branch: null, lastCommitAt: '2026-09-01T00:00:00Z', lastCommitMsg: null, dirty: null, lastSessionAt: null, memoryDigest: null, metrics: {}, collectedAt: '' }],
      ['b', { projectId: 'b', branch: null, lastCommitAt: null, lastCommitMsg: null, dirty: null, lastSessionAt: '2026-09-26T00:00:00Z', memoryDigest: null, metrics: {}, collectedAt: '' }],
    ]);
    expect(sortByRecency([a, b, c], map).map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('paperStageSummary', () => {
  function paper(stage: Paper['stage']): Paper {
    return {
      id: Math.random().toString(36),
      title: 't',
      shortName: 's',
      stage,
      track: 'AI',
      journal: null,
      manuscriptId: null,
      targetJournals: [],
      folderPath: null,
      nextAction: null,
      projectId: null,
      submissions: [],
      sort: 0,
      updatedAt: '',
    };
  }

  it('groups stages and omits empty groups', () => {
    const papers = [paper('writing'), paper('writing'), paper('under_review'), paper('revision'), paper('published')];
    expect(paperStageSummary(papers)).toBe('작성중 2 · 심사중 1 · 수정 1 · 출판 1');
  });

  it('omits groups with zero papers entirely', () => {
    expect(paperStageSummary([paper('writing')])).toBe('작성중 1');
  });
});

describe('nextRevisionDeadline', () => {
  function paper(id: string, shortName: string): Paper {
    return {
      id,
      title: 't',
      shortName,
      stage: 'revision',
      track: 'AI',
      journal: null,
      manuscriptId: null,
      targetJournals: [],
      folderPath: null,
      nextAction: null,
      projectId: null,
      submissions: [],
      sort: 0,
      updatedAt: '',
    };
  }

  it('finds the earliest open paper-revision deadline within 30 days', () => {
    const papers = [paper('p1', 'DILD')];
    const deadlines = [
      deadline({ kind: 'paper', paperId: 'p1', dueDate: '2026-10-08' }), // D+12
      deadline({ kind: 'review', paperId: 'p1', dueDate: '2026-09-27' }), // wrong kind
    ];
    expect(nextRevisionDeadline(papers, deadlines, today)).toEqual({
      paperShortName: 'DILD',
      dueDate: '2026-10-08',
      n: 12,
    });
  });

  it('returns null beyond 30 days or with no match', () => {
    const papers = [paper('p1', 'DILD')];
    const deadlines = [deadline({ kind: 'paper', paperId: 'p1', dueDate: '2026-11-30' })];
    expect(nextRevisionDeadline(papers, deadlines, today)).toBeNull();
    expect(nextRevisionDeadline([], [], today)).toBeNull();
  });
});
