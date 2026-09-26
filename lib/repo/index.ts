import type {
  Assignee,
  CalendarEvent,
  Deadline,
  Milestone,
  MilestoneStatus,
  Note,
  Paper,
  PaperStage,
  Project,
  ProjectActivity,
  ReviewCandidate,
  ReviewJob,
  StatusSnapshot,
  Task,
  TaskStatus,
} from '@/lib/types';
import { LocalRepo } from '@/lib/repo/local';
import { SupabaseRepo } from '@/lib/repo/supabase';

/** Adapter-agnostic data access. All methods are async and return plain objects. */
export interface Repo {
  listNotes(): Promise<Note[]>;
  createNote(input: {
    body: string;
    kind: Note['kind'];
    projectId?: string | null;
    tags?: string[];
    date?: string | null;
    source: Note['source'];
    externalId?: string | null;
  }): Promise<Note>;
  updateNote(id: string, patch: Partial<Omit<Note, 'id' | 'createdAt'>>): Promise<Note>;
  /** Renames/merges a tag across every note in one write. Returns the number of notes touched. */
  mergeTag(from: string, to: string): Promise<number>;

  listProjects(): Promise<Project[]>;
  getProjectBySlug(slug: string): Promise<Project | null>;
  updateProject(id: string, patch: Partial<Omit<Project, 'id' | 'slug'>>): Promise<Project>;

  // machine-written telemetry, phase 2 collector — never touches Project fields
  listProjectActivity(): Promise<ProjectActivity[]>;
  upsertProjectActivity(activity: ProjectActivity): Promise<ProjectActivity>;

  listPapers(): Promise<Paper[]>;
  createPaper(input: {
    shortName: string;
    title: string;
    track: Paper['track'];
    stage?: PaperStage;
    projectId?: string | null;
  }): Promise<Paper>;
  updatePaper(id: string, patch: Partial<Omit<Paper, 'id'>>): Promise<Paper>;
  movePaper(id: string, toStage: PaperStage, toIndex: number): Promise<Paper[]>;

  listReviews(): Promise<ReviewJob[]>;
  createReview(input: {
    journal: string;
    manuscriptId?: string | null;
    title?: string | null;
    dueDate?: string | null;
  }): Promise<ReviewJob>;
  updateReview(id: string, patch: Partial<Omit<ReviewJob, 'id'>>): Promise<ReviewJob>;

  listDeadlines(): Promise<Deadline[]>;
  createDeadline(input: {
    title: string;
    kind: Deadline['kind'];
    dueDate: string;
    dueTime?: string | null;
    projectId?: string | null;
    paperId?: string | null;
    reviewId?: string | null;
  }): Promise<Deadline>;
  updateDeadline(id: string, patch: Partial<Omit<Deadline, 'id'>>): Promise<Deadline>;

  // --- queues (큐) ---
  listMilestones(): Promise<Milestone[]>;
  createMilestone(input: {
    projectId: string;
    title: string;
    startDate?: string | null;
    endDate?: string | null;
    status?: MilestoneStatus;
  }): Promise<Milestone>;
  updateMilestone(id: string, patch: Partial<Omit<Milestone, 'id' | 'projectId'>>): Promise<Milestone>;

  // --- tasks ---
  listTasks(): Promise<Task[]>;
  createTask(input: {
    projectId?: string | null;
    milestoneId?: string | null;
    title: string;
    description?: string | null;
    dueDate?: string | null;
    status?: TaskStatus;
    assignee?: Assignee;
  }): Promise<Task>;
  updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): Promise<Task>;
  moveTask(id: string, toStatus: TaskStatus, toIndex: number): Promise<Task[]>;

  /** Creates a Task from a Note and atomically marks the note done + linked (single write). */
  convertNoteToTask(
    noteId: string,
    input: { projectId: string; milestoneId?: string | null; title: string; dueDate?: string | null }
  ): Promise<Task>;

  // --- machine APIs (phase 1b): cloud status cache + cron heartbeat ---
  getStatusSnapshot(): Promise<StatusSnapshot | null>;
  setStatusSnapshot(snapshot: StatusSnapshot): Promise<void>;
  getHeartbeat(): Promise<string | null>;
  setHeartbeat(at: string): Promise<void>;

  // --- generic key/value metadata (phase 2b: telegram digest idempotency) ---
  getMeta<T>(key: string): Promise<T | null>;
  setMeta(key: string, value: unknown): Promise<void>;
  /** Every key (and parsed value) starting with `prefix` — used by /settings to list
   * dynamic per-account keys like `integration:google:<account>` (slice 4). */
  listMetaByPrefix(prefix: string): Promise<Record<string, unknown>>;

  // --- calendar events (phase 3: one-way Google Calendar mirror) ---
  listCalendarEvents(from: string, to: string): Promise<CalendarEvent[]>;
  /** Deletes `account`'s events overlapping [from, to] and inserts `events` — atomic. */
  replaceCalendarEvents(account: string, from: string, to: string, events: CalendarEvent[]): Promise<void>;

  // --- review candidates (phase 3: Gmail reviewer-mail detection) ---
  listReviewCandidates(status?: ReviewCandidate['status']): Promise<ReviewCandidate[]>;
  /** Inserts only candidates whose messageId isn't already known; returns those newly inserted
   * (existing rows, including dismissed ones, are never touched — they must never reappear). */
  upsertReviewCandidates(
    list: Array<Omit<ReviewCandidate, 'id' | 'status' | 'reviewId' | 'createdAt' | 'updatedAt'>>
  ): Promise<ReviewCandidate[]>;
  updateReviewCandidate(id: string, patch: Partial<Omit<ReviewCandidate, 'id'>>): Promise<ReviewCandidate>;
}

/**
 * Chooses the adapter by env: SupabaseRepo when NEXT_PUBLIC_SUPABASE_URL is set, else
 * LocalRepo. Both `lib/repo/index.ts` and `lib/repo/supabase.ts` are server-only (never
 * imported from a 'use client' component), so this never pulls the service-role key or
 * @supabase/supabase-js into a client bundle — see rubric item 1 in docs/PLAN_1b.md.
 */
export function getRepo(): Repo {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return SupabaseRepo.instance();
  return LocalRepo.instance();
}
