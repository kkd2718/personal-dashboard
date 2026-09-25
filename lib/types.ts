// Core data model. Same shape is mirrored in SQL for phase 1b (Supabase).

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
  pinned: boolean;
  sort: number;
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
  tags: string[];
  pinned: boolean;
  source: 'web' | 'share' | 'telegram' | 'obsidian' | 'gmail' | 'collector';
  deliveredAt: string | null; // set when dispatched to a project's .claude/inbox.md (phase 2)
  createdAt: string;
  updatedAt: string;
}

export interface Db {
  projects: Project[];
  projectActivity: ProjectActivity[];
  papers: Paper[];
  reviews: ReviewJob[];
  deadlines: Deadline[];
  notes: Note[];
}
