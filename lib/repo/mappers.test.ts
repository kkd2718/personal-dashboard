import { describe, expect, it } from 'vitest';
import {
  deadlineFromRow,
  deadlineToRow,
  milestoneFromRow,
  milestoneToRow,
  noteFromRow,
  noteToRow,
  paperFromRow,
  paperToRow,
  projectActivityFromRow,
  projectActivityToRow,
  projectFromRow,
  projectToRow,
  reviewFromRow,
  reviewToRow,
  taskFromRow,
  taskToRow,
} from '@/lib/repo/mappers';
import type {
  Deadline,
  Milestone,
  Note,
  Paper,
  Project,
  ProjectActivity,
  ReviewJob,
  Task,
} from '@/lib/types';

const project: Project = {
  id: 'p1',
  slug: 'p1',
  name: 'Project One',
  group: 'app',
  subgroup: 'sub',
  status: 'active',
  summary: 'summary',
  nextAction: 'do it',
  links: [{ label: 'GitHub', url: 'https://x', kind: 'repo' }],
  paths: ['/a/b'],
  aliases: ['별칭'],
  pinned: true,
  sort: 2,
  color: 'blue',
  updatedAt: '2026-01-01T00:00:00Z',
};

const milestone: Milestone = {
  id: 'm1',
  projectId: 'p1',
  title: 'Queue',
  startDate: '2026-01-01',
  endDate: null,
  status: 'active',
  sort: 0,
  updatedAt: '2026-01-01T00:00:00Z',
};

const task: Task = {
  id: 't1',
  projectId: 'p1',
  milestoneId: 'm1',
  title: 'Do thing',
  description: 'desc',
  status: 'todo',
  dueDate: '2026-01-05',
  doneAt: null,
  assignee: 'agent',
  sort: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const note: Note = {
  id: 'n1',
  body: 'body @p1 #tag',
  kind: 'memo',
  status: 'inbox',
  projectId: 'p1',
  tags: ['tag'],
  date: '2026-01-01',
  pinned: false,
  source: 'shortcut',
  deliveredAt: null,
  taskId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const paper: Paper = {
  id: 'paper1',
  title: 'Title',
  shortName: 'Short',
  stage: 'writing',
  track: 'AI',
  journal: null,
  manuscriptId: null,
  targetJournals: ['J1'],
  folderPath: null,
  nextAction: null,
  projectId: 'p1',
  submissions: [{ journal: 'J1', submittedAt: null, decision: 'pending', decidedAt: null }],
  sort: 0,
  updatedAt: '2026-01-01T00:00:00Z',
};

const review: ReviewJob = {
  id: 'r1',
  journal: 'J1',
  manuscriptId: 'MS-1',
  title: 'Review title',
  status: 'invited',
  invitedAt: '2026-01-01T00:00:00Z',
  dueDate: '2026-02-01',
  link: 'https://x',
  note: 'note',
  updatedAt: '2026-01-01T00:00:00Z',
};

const deadline: Deadline = {
  id: 'd1',
  title: 'Deadline',
  kind: 'paper',
  dueDate: '2026-03-01',
  dueTime: '09:00',
  projectId: 'p1',
  paperId: 'paper1',
  reviewId: null,
  done: false,
  remindDays: [7, 3, 1],
  updatedAt: '2026-01-01T00:00:00Z',
};

const activity: ProjectActivity = {
  projectId: 'p1',
  branch: 'main',
  lastCommitAt: '2026-01-01T00:00:00Z',
  lastCommitMsg: 'fix',
  dirty: false,
  lastSessionAt: null,
  memoryDigest: null,
  metrics: { loc: 100 },
  collectedAt: '2026-01-01T00:00:00Z',
};

describe('mappers round-trip', () => {
  it('project', () => expect(projectFromRow(projectToRow(project))).toEqual(project));
  it('milestone', () => expect(milestoneFromRow(milestoneToRow(milestone))).toEqual(milestone));
  it('task', () => expect(taskFromRow(taskToRow(task))).toEqual(task));
  it('note', () => expect(noteFromRow(noteToRow(note))).toEqual(note));
  it('paper', () => expect(paperFromRow(paperToRow(paper))).toEqual(paper));
  it('review', () => expect(reviewFromRow(reviewToRow(review))).toEqual(review));
  it('deadline', () => expect(deadlineFromRow(deadlineToRow(deadline))).toEqual(deadline));
  it('projectActivity', () => expect(projectActivityFromRow(projectActivityToRow(activity))).toEqual(activity));
});

describe('mappers tolerate missing/null jsonb', () => {
  it('project defaults arrays and color', () => {
    const row = { id: 'p2', slug: 'p2', name: 'P2', group: 'app', status: 'active', updated_at: 'x' };
    const p = projectFromRow(row);
    expect(p.links).toEqual([]);
    expect(p.paths).toEqual([]);
    expect(p.aliases).toEqual([]);
    expect(p.summary).toBe('');
    expect(p.color).toBe('blue');
    expect(p.nextAction).toBeNull();
  });

  it('note defaults tags to []', () => {
    const row = {
      id: 'n2',
      body: 'x',
      kind: 'memo',
      status: 'inbox',
      source: 'web',
      created_at: 'x',
      updated_at: 'x',
    };
    const n = noteFromRow(row);
    expect(n.tags).toEqual([]);
    expect(n.projectId).toBeNull();
    expect(n.taskId).toBeNull();
  });

  it('paper defaults arrays', () => {
    const row = {
      id: 'paper2',
      title: 'T',
      short_name: 'T',
      stage: 'idea',
      track: 'AI',
      updated_at: 'x',
    };
    const p = paperFromRow(row);
    expect(p.targetJournals).toEqual([]);
    expect(p.submissions).toEqual([]);
  });

  it('deadline defaults remindDays to [7,3,1] when empty/missing', () => {
    const row = { id: 'd2', title: 'T', kind: 'other', due_date: '2026-01-01', updated_at: 'x' };
    const d = deadlineFromRow(row);
    expect(d.remindDays).toEqual([7, 3, 1]);
  });

  it('projectActivity defaults metrics to {}', () => {
    const row = { project_id: 'p1', collected_at: 'x' };
    const a = projectActivityFromRow(row);
    expect(a.metrics).toEqual({});
    expect(a.dirty).toBeNull();
  });

  it('task defaults assignee to me', () => {
    const row = {
      id: 't2',
      title: 'T',
      status: 'todo',
      created_at: 'x',
      updated_at: 'x',
    };
    const t = taskFromRow(row);
    expect(t.assignee).toBe('me');
    expect(t.projectId).toBeNull();
    expect(t.milestoneId).toBeNull();
  });
});
