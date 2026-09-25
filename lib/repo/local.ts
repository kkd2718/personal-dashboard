import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  Db,
  Deadline,
  Note,
  Paper,
  PaperStage,
  Project,
  ProjectActivity,
  ReviewJob,
} from '@/lib/types';
import { seedDb } from '@/lib/seed';
import { movePaper as movePaperLogic } from '@/lib/logic/papers';
import type { Repo } from '@/lib/repo/index';

const DB_PATH = path.join(process.cwd(), '.data', 'db.json');

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function notFound(entity: string, id: string): never {
  throw new Error(`${entity} not found: ${id}`);
}

/**
 * JSON-file backed Repo. Reads and writes the whole DB, serialized through an
 * in-process mutex so concurrent Server Actions can't interleave, and writes
 * atomically (temp file + rename) so a crash mid-write can't corrupt the file.
 */
export class LocalRepo implements Repo {
  private static singleton: LocalRepo | undefined;
  private mutex: Promise<unknown> = Promise.resolve();

  static instance(): LocalRepo {
    return (LocalRepo.singleton ??= new LocalRepo());
  }

  private withLock<T>(fn: (db: Db) => Promise<T> | T): Promise<T> {
    const run = this.mutex.catch(() => undefined).then(async () => {
      const db = await this.readDb();
      const result = await fn(db);
      await this.writeDb(db);
      return result;
    });
    this.mutex = run.catch(() => undefined);
    return run;
  }

  private async readDb(): Promise<Db> {
    try {
      const raw = await readFile(DB_PATH, 'utf-8');
      return JSON.parse(raw) as Db;
    } catch (err) {
      if (isEnoent(err)) {
        const fresh = seedDb();
        await this.writeDb(fresh);
        return fresh;
      }
      throw err;
    }
  }

  private async writeDb(db: Db): Promise<void> {
    await mkdir(path.dirname(DB_PATH), { recursive: true });
    const tmp = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2), 'utf-8');
    await rename(tmp, DB_PATH);
  }

  // --- notes ---

  listNotes(): Promise<Note[]> {
    return this.withLock((db) => [...db.notes]);
  }

  createNote(input: {
    body: string;
    kind: Note['kind'];
    projectId?: string | null;
    tags?: string[];
    source: Note['source'];
  }): Promise<Note> {
    return this.withLock((db) => {
      const now = new Date().toISOString();
      const note: Note = {
        id: randomUUID(),
        body: input.body,
        kind: input.kind,
        status: 'inbox',
        projectId: input.projectId ?? null,
        tags: input.tags ?? [],
        pinned: false,
        source: input.source,
        deliveredAt: null,
        createdAt: now,
        updatedAt: now,
      };
      db.notes.push(note);
      return note;
    });
  }

  updateNote(id: string, patch: Partial<Omit<Note, 'id' | 'createdAt'>>): Promise<Note> {
    return this.withLock((db) => {
      const note = db.notes.find((n) => n.id === id);
      if (!note) notFound('Note', id);
      Object.assign(note, patch, { updatedAt: new Date().toISOString() });
      return note;
    });
  }

  // --- projects ---

  listProjects(): Promise<Project[]> {
    return this.withLock((db) => [...db.projects]);
  }

  getProjectBySlug(slug: string): Promise<Project | null> {
    return this.withLock((db) => db.projects.find((p) => p.slug === slug) ?? null);
  }

  updateProject(id: string, patch: Partial<Omit<Project, 'id' | 'slug'>>): Promise<Project> {
    return this.withLock((db) => {
      const project = db.projects.find((p) => p.id === id);
      if (!project) notFound('Project', id);
      Object.assign(project, patch, { updatedAt: new Date().toISOString() });
      return project;
    });
  }

  // --- project activity (machine-written, phase 2 collector) ---

  listProjectActivity(): Promise<ProjectActivity[]> {
    return this.withLock((db) => [...db.projectActivity]);
  }

  upsertProjectActivity(activity: ProjectActivity): Promise<ProjectActivity> {
    return this.withLock((db) => {
      const i = db.projectActivity.findIndex((a) => a.projectId === activity.projectId);
      if (i >= 0) db.projectActivity[i] = activity;
      else db.projectActivity.push(activity);
      return activity;
    });
  }

  // --- papers ---

  listPapers(): Promise<Paper[]> {
    return this.withLock((db) => [...db.papers]);
  }

  updatePaper(id: string, patch: Partial<Omit<Paper, 'id'>>): Promise<Paper> {
    return this.withLock((db) => {
      const paper = db.papers.find((p) => p.id === id);
      if (!paper) notFound('Paper', id);
      Object.assign(paper, patch, { updatedAt: new Date().toISOString() });
      return paper;
    });
  }

  movePaper(id: string, toStage: PaperStage, toIndex: number): Promise<Paper[]> {
    return this.withLock((db) => {
      db.papers = movePaperLogic(db.papers, id, toStage, toIndex);
      return [...db.papers];
    });
  }

  // --- reviews ---

  listReviews(): Promise<ReviewJob[]> {
    return this.withLock((db) => [...db.reviews]);
  }

  createReview(input: {
    journal: string;
    manuscriptId?: string | null;
    title?: string | null;
    dueDate?: string | null;
  }): Promise<ReviewJob> {
    return this.withLock((db) => {
      const now = new Date().toISOString();
      const review: ReviewJob = {
        id: randomUUID(),
        journal: input.journal,
        manuscriptId: input.manuscriptId ?? null,
        title: input.title ?? null,
        status: 'invited',
        invitedAt: now,
        dueDate: input.dueDate ?? null,
        link: null,
        note: null,
        updatedAt: now,
      };
      db.reviews.push(review);
      return review;
    });
  }

  updateReview(id: string, patch: Partial<Omit<ReviewJob, 'id'>>): Promise<ReviewJob> {
    return this.withLock((db) => {
      const review = db.reviews.find((r) => r.id === id);
      if (!review) notFound('ReviewJob', id);
      Object.assign(review, patch, { updatedAt: new Date().toISOString() });
      return review;
    });
  }

  // --- deadlines ---

  listDeadlines(): Promise<Deadline[]> {
    return this.withLock((db) => [...db.deadlines]);
  }

  createDeadline(input: {
    title: string;
    kind: Deadline['kind'];
    dueDate: string;
    dueTime?: string | null;
    projectId?: string | null;
    paperId?: string | null;
    reviewId?: string | null;
  }): Promise<Deadline> {
    return this.withLock((db) => {
      const now = new Date().toISOString();
      const deadline: Deadline = {
        id: randomUUID(),
        title: input.title,
        kind: input.kind,
        dueDate: input.dueDate,
        dueTime: input.dueTime ?? null,
        projectId: input.projectId ?? null,
        paperId: input.paperId ?? null,
        reviewId: input.reviewId ?? null,
        done: false,
        remindDays: [7, 3, 1],
        updatedAt: now,
      };
      db.deadlines.push(deadline);
      return deadline;
    });
  }

  updateDeadline(id: string, patch: Partial<Omit<Deadline, 'id'>>): Promise<Deadline> {
    return this.withLock((db) => {
      const deadline = db.deadlines.find((d) => d.id === id);
      if (!deadline) notFound('Deadline', id);
      Object.assign(deadline, patch, { updatedAt: new Date().toISOString() });
      return deadline;
    });
  }
}
