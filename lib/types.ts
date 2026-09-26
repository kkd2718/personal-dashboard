// Core data model. Same shape is mirrored in SQL for phase 1b (Supabase).

import type { StatusItem } from '@/lib/status/types';

export type Group = 'app' | 'research' | 'personal';
export type ProjectStatus = 'active' | 'paused' | 'done' | 'archived';

export interface LinkRef {
  label: string;
  url: string;
  kind: 'public' | 'local' | 'tailscale' | 'repo' | 'folder';
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  group: Group;
  subgroup: string | null; // e.g. 'AI', '역학', '개인연구', '사업', '재테크', '공부', '커리어'
  status: ProjectStatus;
  summary: string;
  nextAction: string | null;
  links: LinkRef[];
  paths: string[]; // Windows or WSL paths, e.g. 'C:\\Users\\...\\trading-system', '/home/.../amgi'
  aliases: string[]; // extra @-mention names (e.g. Korean nicknames), matched like slug/name
  backlogGlobs: string[]; // relative to paths[0], e.g. ['docs/BACKLOG.md'] (phase 2a collector)
  pinned: boolean;
  sort: number;
  color: string; // tailwind palette key, e.g. 'blue', 'emerald' — accent for calendar/cards
  updatedAt: string;
}

export type MilestoneStatus = 'planned' | 'active' | 'done';

/** UI name: 큐. A dated (or undated) chunk of work inside a project. */
export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  startDate: string | null; // 'YYYY-MM-DD', inclusive
  endDate: string | null; // 'YYYY-MM-DD', inclusive
  status: MilestoneStatus;
  sort: number;
  updatedAt: string;
}

export type TaskStatus = 'todo' | 'doing' | 'done';

/** Who is responsible: the user, or a Claude agent session (phase 2 delivers these via a
 * SessionStart hook into that project's session; in 1d the user still ticks them manually). */
export type Assignee = 'me' | 'agent';

export interface Task {
  id: string;
  projectId: string | null;
  milestoneId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: string | null; // 'YYYY-MM-DD'
  doneAt: string | null;
  assignee: Assignee; // default 'me'
  deliveredAt: string | null; // set on first agent-inbox delivery (phase 2a), agent tasks only
  sort: number; // dense per (projectId, status)
  createdAt: string;
  updatedAt: string;
}

/**
 * Machine-written project telemetry (collector, phase 2). Kept separate from
 * Project so the collector never clobbers user edits. One row per project,
 * upserted wholesale on each collection run.
 */
export interface ProjectActivity {
  projectId: string;
  branch: string | null;
  lastCommitAt: string | null;
  lastCommitMsg: string | null;
  dirty: boolean | null;
  lastSessionAt: string | null;
  memoryDigest: string | null;
  metrics: Record<string, number | string>;
  collectedAt: string;
}

export type PaperStage =
  | 'idea'
  | 'writing'
  | 'submitted'
  | 'under_review'
  | 'revision'
  | 'accepted'
  | 'published';

export interface Paper {
  id: string;
  title: string;
  shortName: string;
  stage: PaperStage;
  track: 'AI' | '역학' | '개인연구' | '기타';
  journal: string | null;
  manuscriptId: string | null;
  targetJournals: string[];
  folderPath: string | null; // may lag behind stage
  nextAction: string | null;
  projectId: string | null;
  submissions: PaperSubmission[];
  sort: number;
  updatedAt: string;
}

export type SubmissionDecision =
  | 'pending'
  | 'desk_reject'
  | 'reject'
  | 'major'
  | 'minor'
  | 'accept';

export interface PaperSubmission {
  journal: string;
  submittedAt: string | null;
  decision: SubmissionDecision | null;
  decidedAt: string | null;
}

export type ReviewStatus = 'invited' | 'accepted' | 'submitted' | 'declined';

export interface ReviewJob {
  id: string;
  journal: string;
  manuscriptId: string | null;
  title: string | null;
  status: ReviewStatus;
  invitedAt: string | null;
  dueDate: string | null; // YYYY-MM-DD
  link: string | null;
  note: string | null;
  updatedAt: string;
}

export type DeadlineKind =
  | 'paper'
  | 'review'
  | 'grant'
  | 'thesis'
  | 'interview'
  | 'date'
  | 'personal'
  | 'other';

export interface Deadline {
  id: string;
  title: string;
  kind: DeadlineKind;
  dueDate: string; // YYYY-MM-DD
  dueTime: string | null; // 'HH:mm' KST
  projectId: string | null;
  paperId: string | null;
  reviewId: string | null;
  done: boolean;
  remindDays: number[]; // default [7, 3, 1]
  updatedAt: string;
}

export type NoteKind = 'idea' | 'memo' | 'todo' | 'link';
export type NoteStatus = 'inbox' | 'filed' | 'sent' | 'done' | 'archived';

export interface Note {
  id: string;
  body: string;
  kind: NoteKind;
  status: NoteStatus;
  projectId: string | null;
  tags: string[]; // stored as entered; compare case-insensitively
  date: string | null; // 'YYYY-MM-DD': memo pinned to a calendar day
  pinned: boolean;
  source: 'web' | 'share' | 'shortcut' | 'telegram' | 'obsidian' | 'gmail' | 'collector';
  deliveredAt: string | null; // set when dispatched to a project's .claude/inbox.md (phase 2)
  taskId: string | null; // set when converted to a Task via convertNoteToTask
  createdAt: string;
  updatedAt: string;
}

/** Cloud status-panel cache, written by POST /api/ingest (see lib/repo Repo interface). */
export interface StatusSnapshot {
  items: StatusItem[];
  collectedAt: string;
}

export interface Db {
  projects: Project[];
  projectActivity: ProjectActivity[];
  papers: Paper[];
  reviews: ReviewJob[];
  deadlines: Deadline[];
  notes: Note[];
  milestones: Milestone[];
  tasks: Task[];
  statusSnapshot: StatusSnapshot | null;
  heartbeatAt: string | null;
}
