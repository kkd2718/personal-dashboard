import type {
  Assignee,
  Deadline,
  Milestone,
  MilestoneStatus,
  Note,
  Paper,
  PaperStage,
  Project,
  ProjectActivity,
  ReviewJob,
  Task,
  TaskStatus,
} from '@/lib/types';
import { LocalRepo } from '@/lib/repo/local';

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
}

/** Chooses the adapter by env: LocalRepo unless NEXT_PUBLIC_SUPABASE_URL is set (SupabaseRepo lands in phase 1b). */
export function getRepo(): Repo {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('SupabaseRepo is not implemented yet (phase 1b). Unset NEXT_PUBLIC_SUPABASE_URL.');
  }
  return LocalRepo.instance();
}
