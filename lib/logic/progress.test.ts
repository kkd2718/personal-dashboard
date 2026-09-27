import { describe, expect, it } from 'vitest';
import { backlogLabel, backlogProgress, labeledBars, labeledBarText, progress, progressLabel, shouldShowBacklogBar } from './progress';
import type { Project, ProjectActivity, Task } from '@/lib/types';

function task(status: Task['status']): Task {
  return {
    id: Math.random().toString(36),
    projectId: 'p1',
    milestoneId: null,
    title: 't',
    description: null,
    status,
    dueDate: null,
    doneAt: null,
    assignee: 'me',
    deliveredAt: null,
    sort: 0,
    createdAt: '2026-09-25T00:00:00Z',
    updatedAt: '2026-09-25T00:00:00Z',
  };
}

describe('progress', () => {
  it('returns null pct for an empty list', () => {
    expect(progress([])).toEqual({ done: 0, total: 0, pct: null });
  });

  it('rounds pct: 1 of 3 done -> 33', () => {
    const tasks = [task('done'), task('todo'), task('doing')];
    expect(progress(tasks)).toEqual({ done: 1, total: 3, pct: 33 });
  });
});

describe('progressLabel', () => {
  it('never renders "0/1 (0%)": below 3 tasks shows the count only', () => {
    expect(progressLabel({ done: 0, total: 1, pct: 0 })).toBe('할 일 1개');
    expect(progressLabel({ done: 1, total: 2, pct: 50 })).toBe('할 일 2개');
  });

  it('shows done/total 완료 at 3 or more tasks', () => {
    expect(progressLabel({ done: 2, total: 5, pct: 40 })).toBe('2/5 완료');
  });
});

describe('backlogLabel', () => {
  it('labels the backlog bar 백로그, not BACKLOG', () => {
    expect(backlogLabel({ done: 12, total: 40, pct: 30 })).toBe('백로그 12/40');
  });
});

function activity(metrics: Record<string, number | string>): ProjectActivity {
  return {
    projectId: 'p-amgi',
    branch: null,
    lastCommitAt: null,
    lastCommitMsg: null,
    dirty: null,
    lastSessionAt: null,
    memoryDigest: null,
    metrics,
    collectedAt: '2026-09-25T00:00:00Z',
  };
}

function project(overrides: Partial<Project>): Project {
  return {
    id: 'p-amgi',
    slug: 'amgi',
    name: 'Amgi',
    group: 'app',
    subgroup: null,
    status: 'active',
    summary: '',
    nextAction: null,
    links: [],
    paths: [],
    aliases: [],
    backlogGlobs: ['docs/BACKLOG.md'],
    pinned: false,
    sort: 0,
    color: 'blue',
    updatedAt: '2026-09-25',
    ...overrides,
  };
}

describe('backlogProgress', () => {
  it('null when the activity has no backlog metrics', () => {
    expect(backlogProgress(activity({}))).toBeNull();
    expect(backlogProgress(undefined)).toBeNull();
  });

  it('computes done/total/pct from backlogOpen/backlogDone metrics', () => {
    expect(backlogProgress(activity({ backlogOpen: 3, backlogDone: 1 }))).toEqual({
      done: 1,
      total: 4,
      pct: 25,
    });
  });
});

describe('shouldShowBacklogBar', () => {
  it('shows when the project has 0 tasks and a non-empty backlog', () => {
    const p = project({ group: 'research' });
    expect(shouldShowBacklogBar(p, [], { done: 1, total: 4, pct: 25 })).toBe(true);
  });

  it('shows for an app-group project even with tasks', () => {
    const p = project({ group: 'app' });
    const tasks: Task[] = [{ ...task('todo'), projectId: p.id }];
    expect(shouldShowBacklogBar(p, tasks, { done: 1, total: 4, pct: 25 })).toBe(true);
  });

  it('hides for a non-app project that already has tasks', () => {
    const p = project({ group: 'research' });
    const tasks: Task[] = [{ ...task('todo'), projectId: p.id }];
    expect(shouldShowBacklogBar(p, tasks, { done: 1, total: 4, pct: 25 })).toBe(false);
  });

  it('hides when there is no backlog progress', () => {
    const p = project({ group: 'app' });
    expect(shouldShowBacklogBar(p, [], null)).toBe(false);
  });
});

describe('labeledBars', () => {
  const act = (metrics: Record<string, number | string>) => ({ metrics }) as ProjectActivity;

  it('reads bar:<label>:done/open pairs in order, with percentages', () => {
    const bars = labeledBars(act({ backlogOpen: 1, 'bar:코드:done': 8, 'bar:코드:open': 4, 'bar:노트:done': 1, 'bar:노트:open': 3 }));
    expect(bars).toEqual([
      { label: '코드', done: 8, total: 12, pct: 67 },
      { label: '노트', done: 1, total: 4, pct: 25 },
    ]);
    expect(labeledBarText(bars[0])).toBe('코드 67%');
  });

  it('empty without activity or bar metrics', () => {
    expect(labeledBars(undefined)).toEqual([]);
    expect(labeledBars(act({ backlogOpen: 3 }))).toEqual([]);
  });
});
