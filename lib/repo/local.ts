import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  Assignee,
  Db,
  Deadline,
  Milestone,
  MilestoneStatus,
  Note,
  Paper,
  PaperStage,
  Project,
  ProjectActivity,
  ReviewJob,
  StatusSnapshot,
  Task,
  TaskStatus,
} from '@/lib/types';
import { seedDb } from '@/lib/seed/index';
import { movePaper as movePaperLogic } from '@/lib/logic/papers';
import { moveTask as moveTaskLogic } from '@/lib/logic/tasks';
import type { Repo } from '@/lib/repo/index';

const DB_PATH = path.join(process.cwd(), '.data', 'db.json');

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function notFound(entity: string, id: string): never {
  throw new Error(`${entity} not found: ${id}`);
}

const PROJECT_COLORS = ['blue', 'emerald', 'violet', 'amber', 'rose', 'cyan', 'lime', 'fuchsia'];

/**
 * Tolerant loader: fills in arrays/fields added after a db.json was first written,
 * so an old file never crashes the app. New arrays default to []; new fields on
 * existing rows default to null (or a generated fallback for `color`).
 */
function normalizeDb(raw: Partial<Db>): Db {
  const projects = (raw.projects ?? []).map((p, i) => ({
    ...p,
    color: p.color ?? PROJECT_COLORS[i % PROJECT_COLORS.length],
    aliases: p.aliases ?? [],
    backlogGlobs: p.backlogGlobs ?? [],
  }));
  const notes = (raw.notes ?? []).map((n) => ({ ...n, taskId: n.taskId ?? null, date: n.date ?? null }));
  const tasks = (raw.tasks ?? []).map((t) => ({ ...t, assignee: t.assignee ?? 'me', deliveredAt: t.deliveredAt ?? null }));
  return {
    projects,
    projectActivity: raw.projectActivity ?? [],
    papers: raw.papers ?? [],
    reviews: raw.reviews ?? [],
    deadlines: raw.deadlines ?? [],
    notes,
    milestones: raw.milestones ?? [],
    tasks,
    statusSnapshot: raw.statusSnapshot ?? null,
    heartbeatAt: raw.heartbeatAt ?? null,
  };
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
      return normalizeDb(JSON.parse(raw) as Partial<Db>);
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
    date?: string | null;
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
        date: input.date ?? null,
        pinned: false,
        source: input.source,
        deliveredAt: null,
        taskId: null,
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

  /** Renames tag `from` to `to` (or merges into it if `to` already exists) across every note, in one write. */
  mergeTag(from: string, to: string): Promise<number> {
    return this.withLock((db) => {
      const fromLower = from.toLowerCase();
      const now = new Date().toISOString();
      let count = 0;
      for (const note of db.notes) {
        if (!note.tags.some((t) => t.toLowerCase() === fromLower)) continue;
        const seen = new Set<string>();
        const tags: string[] = [];
        for (const t of note.tags.map((t) => (t.toLowerCase() === fromLower ? to : t))) {
          const key = t.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            tags.push(t);
          }
        }
        note.tags = tags;
        note.updatedAt = now;
        count += 1;
      }
      return count;
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

  // --- milestones (큐) ---

  listMilestones(): Promise<Milestone[]> {
    return this.withLock((db) => [...db.milestones]);
  }

  createMilestone(input: {
    projectId: string;
    title: string;
    startDate?: string | null;
    endDate?: string | null;
    status?: MilestoneStatus;
  }): Promise<Milestone> {
    return this.withLock((db) => {
      const now = new Date().toISOString();
      const siblings = db.milestones.filter((m) => m.projectId === input.projectId);
      const milestone: Milestone = {
        id: randomUUID(),
        projectId: input.projectId,
        title: input.title,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        status: input.status ?? 'planned',
        sort: siblings.length,
        updatedAt: now,
      };
      db.milestones.push(milestone);
      return milestone;
    });
  }

  updateMilestone(
    id: string,
    patch: Partial<Omit<Milestone, 'id' | 'projectId'>>
  ): Promise<Milestone> {
    return this.withLock((db) => {
      const milestone = db.milestones.find((m) => m.id === id);
      if (!milestone) notFound('Milestone', id);
      Object.assign(milestone, patch, { updatedAt: new Date().toISOString() });
      return milestone;
    });
  }

  // --- tasks ---

  listTasks(): Promise<Task[]> {
    return this.withLock((db) => [...db.tasks]);
  }

  createTask(input: {
    projectId?: string | null;
    milestoneId?: string | null;
    title: string;
    description?: string | null;
    dueDate?: string | null;
    status?: TaskStatus;
    assignee?: Assignee;
  }): Promise<Task> {
    return this.withLock((db) => {
      const now = new Date().toISOString();
      const status = input.status ?? 'todo';
      const projectId = input.projectId ?? null;
      const siblings = db.tasks.filter((t) => t.projectId === projectId && t.status === status);
      const task: Task = {
        id: randomUUID(),
        projectId,
        milestoneId: input.milestoneId ?? null,
        title: input.title,
        description: input.description ?? null,
        status,
        dueDate: input.dueDate ?? null,
        doneAt: status === 'done' ? now : null,
        assignee: input.assignee ?? 'me',
        deliveredAt: null,
        sort: siblings.length,
        createdAt: now,
        updatedAt: now,
      };
      db.tasks.push(task);
      return task;
    });
  }

  updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): Promise<Task> {
    return this.withLock((db) => {
      const task = db.tasks.find((t) => t.id === id);
      if (!task) notFound('Task', id);
      const now = new Date().toISOString();
      const wasDone = task.status === 'done';
      Object.assign(task, patch, { updatedAt: now });
      if (task.status === 'done' && !wasDone && patch.doneAt === undefined) task.doneAt = now;
      if (task.status !== 'done' && patch.doneAt === undefined) task.doneAt = null;
      return task;
    });
  }

  moveTask(id: string, toStatus: TaskStatus, toIndex: number): Promise<Task[]> {
    return this.withLock((db) => {
      db.tasks = moveTaskLogic(db.tasks, id, toStatus, toIndex);
      return [...db.tasks];
    });
  }

  convertNoteToTask(
    noteId: string,
    input: { projectId: string; milestoneId?: string | null; title: string; dueDate?: string | null }
  ): Promise<Task> {
    return this.withLock((db) => {
      const note = db.notes.find((n) => n.id === noteId);
      if (!note) notFound('Note', noteId);
      const now = new Date().toISOString();
      const projectId = input.projectId;
      const siblings = db.tasks.filter((t) => t.projectId === projectId && t.status === 'todo');
      const task: Task = {
        id: randomUUID(),
        projectId,
        milestoneId: input.milestoneId ?? null,
        title: input.title,
        description: note.body,
        status: 'todo',
        dueDate: input.dueDate ?? null,
        doneAt: null,
        assignee: 'me',
        deliveredAt: null,
        sort: siblings.length,
        createdAt: now,
        updatedAt: now,
      };
      db.tasks.push(task);
      Object.assign(note, { status: 'done', taskId: task.id, updatedAt: now });
      return task;
    });
  }

  // --- machine APIs: cloud status cache + cron heartbeat ---

  getStatusSnapshot(): Promise<StatusSnapshot | null> {
    return this.withLock((db) => db.statusSnapshot);
  }

  setStatusSnapshot(snapshot: StatusSnapshot): Promise<void> {
    return this.withLock((db) => {
      db.statusSnapshot = snapshot;
    });
  }

  getHeartbeat(): Promise<string | null> {
    return this.withLock((db) => db.heartbeatAt);
  }

  setHeartbeat(at: string): Promise<void> {
    return this.withLock((db) => {
      db.heartbeatAt = at;
    });
  }
}
