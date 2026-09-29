import { describe, expect, it } from 'vitest';
import {
  buildQueueLaneCards,
  deadlineCounts,
  headerCountLabel,
  nextRevisionDeadline,
  paperStageSummary,
  projectActivitySentence,
  sortByRecency,
} from './home';
import type { Deadline, Milestone, Paper, Project, ProjectActivity, Task } from '@/lib/types';

const today = '2026-09-26'; // Saturday

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
    const thu = '2026-09-24'; // Sunday-start week Sun 09-20..Sat 09-26
    const deadlines = [
      deadline({ dueDate: '2026-09-20' }), // overdue
      deadline({ dueDate: thu }), // today
      deadline({ dueDate: '2026-09-26' }), // this week (Saturday, week end)
      deadline({ dueDate: '2026-09-27' }), // next week (Sunday)
      deadline({ dueDate: '2026-09-20', done: true }), // ignored
    ];
    expect(deadlineCounts(deadlines, thu)).toEqual({ overdue: 1, today: 1, thisWeek: 1 });
  });
});

describe('headerCountLabel', () => {
  it('joins non-zero parts only', () => {
    expect(headerCountLabel({ overdue: 1, today: 0, thisWeek: 2 })).toBe('이번 주 2 · 지남 1');
  });

  it('falls back to a no-deadlines sentence when all zero', () => {
    expect(headerCountLabel({ overdue: 0, today: 0, thisWeek: 0 })).toBe('이번 주 마감 없음');
  });

  it('names the next deadline when nothing is due this week', () => {
    expect(
      headerCountLabel({ overdue: 0, today: 0, thisWeek: 0 }, { title: 'Fic 리비전 제출', dueDate: '2026-10-17', today: '2026-09-27' })
    ).toBe('다음 마감 D-20 · 10/17 Fic 리비전 제출');
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

describe('buildQueueLaneCards', () => {
  function makeProject(overrides: Partial<Project>): Project {
    return {
      id: 'p1',
      slug: 'p1',
      name: 'p1',
      group: 'research',
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
      ...overrides,
    };
  }

  function makeMilestone(overrides: Partial<Milestone>): Milestone {
    return {
      id: 'm1',
      projectId: 'p1',
      title: 'queue',
      startDate: null,
      endDate: null,
      status: 'active',
      sort: 0,
      updatedAt: '',
      ...overrides,
    };
  }

  function makeTask(overrides: Partial<Task>): Task {
    return {
      id: Math.random().toString(36),
      projectId: 'p1',
      milestoneId: null,
      title: 't',
      description: null,
      status: 'todo',
      dueDate: null,
      doneAt: null,
      assignee: 'me',
      deliveredAt: null,
      sort: 0,
      createdAt: '',
      updatedAt: '',
      ...overrides,
    };
  }

  it('one queue card per active milestone, with progress and the first undone task', () => {
    const project = makeProject({});
    const milestone = makeMilestone({});
    const tasks = [
      makeTask({ id: 't1', milestoneId: 'm1', status: 'done', sort: 0 }),
      makeTask({ id: 't2', milestoneId: 'm1', status: 'todo', sort: 1 }),
    ];
    const cards = buildQueueLaneCards([project], [milestone], tasks, []);
    expect(cards).toEqual([
      {
        kind: 'queue',
        project,
        milestone,
        progress: { done: 1, total: 2, pct: 50 },
        nextTaskTitle: 't',
        agentOpenCount: 0,
      },
    ]);
  });

  it('falls back to a backlog card when there is no active milestone', () => {
    const project = makeProject({ id: 'p2' });
    const activity: ProjectActivity = {
      projectId: 'p2',
      branch: null,
      lastCommitAt: null,
      lastCommitMsg: null,
      dirty: null,
      lastSessionAt: null,
      memoryDigest: null,
      metrics: { backlogOpen: 3, backlogDone: 1 },
      collectedAt: '',
    };
    const cards = buildQueueLaneCards([project], [], [], [activity]);
    expect(cards).toEqual([{ kind: 'backlog', project, backlog: { done: 1, total: 4, pct: 25 } }]);
  });

  it('falls back to a nextAction row when there is no queue or backlog', () => {
    const project = makeProject({ id: 'p3', nextAction: '로컬 UI 검토' });
    const cards = buildQueueLaneCards([project], [], [], []);
    expect(cards).toEqual([{ kind: 'nextAction', project, nextAction: '로컬 UI 검토' }]);
  });

  it('excludes non-active projects and orders app before research/personal', () => {
    const app = makeProject({ id: 'a', group: 'app', sort: 1, nextAction: 'x' });
    const research = makeProject({ id: 'r', group: 'research', sort: 0, nextAction: 'y' });
    const paused = makeProject({ id: 'z', status: 'paused', nextAction: 'z' });
    const cards = buildQueueLaneCards([research, app, paused], [], [], []);
    expect(cards.map((c) => c.project.id)).toEqual(['a', 'r']);
  });

  it('skips the bare next-action card when the project has a linked paper', () => {
    const withPaper = makeProject({ id: 'p-a', group: 'research', nextAction: '데이터 확인' });
    const without = makeProject({ id: 'p-b', group: 'research', nextAction: '데이터 확인' });
    const papers = [{ projectId: 'p-a' } as Paper];
    const cards = buildQueueLaneCards([withPaper, without], [], [], [], papers);
    expect(cards.map((c) => c.project.id)).toEqual(['p-b']);
  });
});
