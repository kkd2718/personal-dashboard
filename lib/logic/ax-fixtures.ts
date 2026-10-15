// Test-only factories for the AX logic tests.
import type { Deadline, Paper, Project, Task } from '@/lib/types';

export const task = (o: Partial<Task> & { id: string; title: string }): Task => ({
  projectId: null,
  milestoneId: null,
  description: null,
  status: 'todo',
  dueDate: null,
  doneAt: null,
  assignee: 'me',
  deliveredAt: null,
  sort: 0,
  createdAt: 't',
  updatedAt: 't',
  ...o,
});

export const deadline = (o: Partial<Deadline> & { id: string; title: string }): Deadline =>
  ({
    kind: 'other',
    dueDate: '2026-10-20',
    dueTime: null,
    projectId: null,
    paperId: null,
    reviewId: null,
    done: false,
    remindDays: [7, 3, 1],
    updatedAt: 't',
    ...o,
  }) as Deadline;

export const project = (o: Partial<Project> & { id: string; slug: string; name: string }): Project =>
  ({
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
    updatedAt: 't',
    ...o,
  }) as Project;

export const paper = (o: Partial<Paper> & { id: string; shortName: string }): Paper =>
  ({ title: o.shortName, stage: 'drafting', track: 'AI', projectId: null, ...o }) as Paper;
