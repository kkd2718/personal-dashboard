import type {
  Deadline,
  Note,
  Paper,
  PaperStage,
  Project,
  ProjectActivity,
  ReviewJob,
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
    source: Note['source'];
  }): Promise<Note>;
  updateNote(id: string, patch: Partial<Omit<Note, 'id' | 'createdAt'>>): Promise<Note>;

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
}

/** Chooses the adapter by env: LocalRepo unless NEXT_PUBLIC_SUPABASE_URL is set (SupabaseRepo lands in phase 1b). */
export function getRepo(): Repo {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('SupabaseRepo is not implemented yet (phase 1b). Unset NEXT_PUBLIC_SUPABASE_URL.');
  }
  return LocalRepo.instance();
}
