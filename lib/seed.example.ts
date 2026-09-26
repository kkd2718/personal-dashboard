import type {
  Db,
  Deadline,
  Milestone,
  Note,
  Paper,
  Project,
  ProjectActivity,
  ReviewJob,
  Task,
} from '@/lib/types';

// Fictional sample data, committed to the repo so a fresh clone runs out of the box.
// Real data lives in data/seed.local.json (gitignored) — see lib/seed/index.ts.
const NOW = '2026-01-01T09:00:00+09:00';

const projects: Project[] = [
  {
    id: 'p-sample-app',
    slug: 'sample-app',
    name: '샘플 앱 (sample-app)',
    group: 'app',
    subgroup: '서비스',
    status: 'active',
    summary: '예시 프로젝트 — 실제 데이터는 data/seed.local.json에 있습니다',
    nextAction: '베타 사용자 모집',
    links: [{ label: 'GitHub', url: 'https://github.com/example/sample-app', kind: 'repo' }],
    paths: ['/home/example/projects/sample-app'],
    pinned: true,
    aliases: ['샘플'],
    sort: 0,
    color: 'cyan',
    updatedAt: NOW,
  },
  {
    id: 'p-sample-research',
    slug: 'sample-research',
    name: 'SampleResearch',
    group: 'research',
    subgroup: 'AI',
    status: 'active',
    summary: '예시 연구 프로젝트',
    nextAction: '1차 초안 작성',
    links: [],
    paths: [],
    pinned: false,
    aliases: [],
    sort: 0,
    color: 'emerald',
    updatedAt: NOW,
  },
  {
    id: 'p-sample-personal',
    slug: 'sample-personal',
    name: '개인 프로젝트 예시',
    group: 'personal',
    subgroup: '공부',
    status: 'active',
    summary: '',
    nextAction: null,
    links: [],
    paths: [],
    pinned: false,
    aliases: [],
    sort: 0,
    color: 'violet',
    updatedAt: NOW,
  },
];

const projectActivity: ProjectActivity[] = [];

const papers: Paper[] = [
  {
    id: 'paper-sample-1',
    title: 'Sample Paper One',
    shortName: 'SamplePaper1',
    stage: 'writing',
    track: 'AI',
    journal: null,
    manuscriptId: null,
    targetJournals: ['Sample Journal'],
    folderPath: null,
    nextAction: '초안 완성',
    projectId: 'p-sample-research',
    submissions: [],
    sort: 0,
    updatedAt: NOW,
  },
  {
    id: 'paper-sample-2',
    title: 'Sample Paper Two',
    shortName: 'SamplePaper2',
    stage: 'under_review',
    track: '역학',
    journal: 'Sample Journal',
    manuscriptId: 'SJ-2026-0001',
    targetJournals: [],
    folderPath: null,
    nextAction: null,
    projectId: null,
    submissions: [{ journal: 'Sample Journal', submittedAt: '2025-12-01', decision: 'pending', decidedAt: null }],
    sort: 1,
    updatedAt: NOW,
  },
];

const reviews: ReviewJob[] = [];
const deadlines: Deadline[] = [];

const milestones: Milestone[] = [
  {
    id: 'ms-sample-launch',
    projectId: 'p-sample-app',
    title: '베타 런칭',
    startDate: null,
    endDate: null,
    status: 'active',
    sort: 0,
    updatedAt: NOW,
  },
];

const tasks: Task[] = [
  {
    id: 't-sample-1',
    projectId: 'p-sample-app',
    milestoneId: 'ms-sample-launch',
    title: '베타 사용자 모집 링크 준비',
    description: null,
    status: 'todo',
    dueDate: null,
    doneAt: null,
    assignee: 'me',
    sort: 0,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 't-sample-2',
    projectId: 'p-sample-app',
    milestoneId: 'ms-sample-launch',
    title: '배포 자동화',
    description: null,
    status: 'todo',
    dueDate: null,
    doneAt: null,
    assignee: 'agent',
    sort: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const notes: Note[] = [
  {
    id: 'note-sample-1',
    body: '[예시] 메모에 아이디어를 빠르게 적어두세요. 나중에 할 일로 바꿀 수 있습니다.',
    kind: 'idea',
    status: 'inbox',
    projectId: null,
    tags: ['예시'],
    date: null,
    pinned: false,
    source: 'web',
    deliveredAt: null,
    taskId: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'note-sample-2',
    body: '[예시] 링크 공유도 여기로 모입니다. 모바일에서 공유 → Command Center 선택.',
    kind: 'link',
    status: 'inbox',
    projectId: null,
    tags: ['예시'],
    date: null,
    pinned: false,
    source: 'share',
    deliveredAt: null,
    taskId: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

/** Fresh copy of the example database (deep-cloned, safe to mutate). */
export function exampleSeedDb(): Db {
  return JSON.parse(
    JSON.stringify({
      projects,
      projectActivity,
      papers,
      reviews,
      deadlines,
      notes,
      milestones,
      tasks,
    })
  ) as Db;
}
