// Server-only. Supabase-backed Repo using the service-role key (bypasses RLS —
// never import this from a client component or expose the key to the browser).
if (typeof window !== 'undefined') {
  throw new Error('lib/repo/supabase.ts is server-only');
}

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
  StatusSnapshot,
  Task,
  TaskStatus,
} from '@/lib/types';
import { moveTask as moveTaskLogic } from '@/lib/logic/tasks';
import { movePaper as movePaperLogic } from '@/lib/logic/papers';
import type { Repo } from '@/lib/repo/index';
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

function notFound(entity: string, id: string): never {
  throw new Error(`${entity} not found: ${id}`);
}

function now(): string {
  return new Date().toISOString();
}

/** Throws (not asserted at import time) so LocalRepo-only tests/builds don't need the env set. */
function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

export class SupabaseRepo implements Repo {
  private static singleton: SupabaseRepo | undefined;
  private sb: SupabaseClient;

  private constructor() {
    this.sb = client();
  }

  static instance(): SupabaseRepo {
    return (SupabaseRepo.singleton ??= new SupabaseRepo());
  }

  private async selectAll<T>(table: string, mapper: (r: Record<string, unknown>) => T): Promise<T[]> {
    const { data, error } = await this.sb.from(table).select('*');
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []).map(mapper);
  }

  // --- notes ---

  listNotes(): Promise<Note[]> {
    return this.selectAll('notes', noteFromRow);
  }

  async createNote(input: {
    body: string;
    kind: Note['kind'];
    projectId?: string | null;
    tags?: string[];
    date?: string | null;
    source: Note['source'];
  }): Promise<Note> {
    const n = now();
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
      createdAt: n,
      updatedAt: n,
    };
    const { error } = await this.sb.from('notes').insert(noteToRow(note));
    if (error) throw new Error(`createNote: ${error.message}`);
    return note;
  }

  async updateNote(id: string, patch: Partial<Omit<Note, 'id' | 'createdAt'>>): Promise<Note> {
    const { data, error } = await this.sb
      .from('notes')
      .update({ ...noteToRow(patch as Note), updated_at: now() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) notFound('Note', id);
    return noteFromRow(data);
  }

  async mergeTag(from: string, to: string): Promise<number> {
    const { data, error } = await this.sb.rpc('merge_tag', { p_from: from, p_to: to, p_now: now() });
    if (error) throw new Error(`mergeTag: ${error.message}`);
    return (data as number) ?? 0;
  }

  // --- projects ---

  listProjects(): Promise<Project[]> {
    return this.selectAll('projects', projectFromRow);
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    const { data, error } = await this.sb.from('projects').select('*').eq('slug', slug).maybeSingle();
    if (error) throw new Error(`getProjectBySlug: ${error.message}`);
    return data ? projectFromRow(data) : null;
  }

  async updateProject(id: string, patch: Partial<Omit<Project, 'id' | 'slug'>>): Promise<Project> {
    const { data, error } = await this.sb
      .from('projects')
      .update({ ...projectToRow(patch as Project), updated_at: now() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) notFound('Project', id);
    return projectFromRow(data);
  }

  // --- project activity ---

  listProjectActivity(): Promise<ProjectActivity[]> {
    return this.selectAll('project_activity', projectActivityFromRow);
  }

  async upsertProjectActivity(activity: ProjectActivity): Promise<ProjectActivity> {
    const { error } = await this.sb
      .from('project_activity')
      .upsert(projectActivityToRow(activity), { onConflict: 'project_id' });
    if (error) throw new Error(`upsertProjectActivity: ${error.message}`);
    return activity;
  }

  // --- papers ---

  listPapers(): Promise<Paper[]> {
    return this.selectAll('papers', paperFromRow);
  }

  async updatePaper(id: string, patch: Partial<Omit<Paper, 'id'>>): Promise<Paper> {
    const { data, error } = await this.sb
      .from('papers')
      .update({ ...paperToRow(patch as Paper), updated_at: now() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) notFound('Paper', id);
    return paperFromRow(data);
  }

  async movePaper(id: string, toStage: PaperStage, toIndex: number): Promise<Paper[]> {
    const papers = await this.listPapers();
    const next = movePaperLogic(papers, id, toStage, toIndex);
    const diffs = next.filter((p) => {
      const before = papers.find((b) => b.id === p.id);
      return !before || before.stage !== p.stage || before.sort !== p.sort;
    });
    if (diffs.length > 0) {
      const { error } = await this.sb.rpc('reorder_papers', {
        p_updates: diffs.map((p) => ({ id: p.id, stage: p.stage, sort: p.sort })),
        p_now: now(),
      });
      if (error) throw new Error(`movePaper: ${error.message}`);
    }
    return next;
  }

  // --- reviews ---

  listReviews(): Promise<ReviewJob[]> {
    return this.selectAll('review_jobs', reviewFromRow);
  }

  async createReview(input: {
    journal: string;
    manuscriptId?: string | null;
    title?: string | null;
    dueDate?: string | null;
  }): Promise<ReviewJob> {
    const n = now();
    const review: ReviewJob = {
      id: randomUUID(),
      journal: input.journal,
      manuscriptId: input.manuscriptId ?? null,
      title: input.title ?? null,
      status: 'invited',
      invitedAt: n,
      dueDate: input.dueDate ?? null,
      link: null,
      note: null,
      updatedAt: n,
    };
    const { error } = await this.sb.from('review_jobs').insert(reviewToRow(review));
    if (error) throw new Error(`createReview: ${error.message}`);
    return review;
  }

  async updateReview(id: string, patch: Partial<Omit<ReviewJob, 'id'>>): Promise<ReviewJob> {
    const { data, error } = await this.sb
      .from('review_jobs')
      .update({ ...reviewToRow(patch as ReviewJob), updated_at: now() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) notFound('ReviewJob', id);
    return reviewFromRow(data);
  }

  // --- deadlines ---

  listDeadlines(): Promise<Deadline[]> {
    return this.selectAll('deadlines', deadlineFromRow);
  }

  async createDeadline(input: {
    title: string;
    kind: Deadline['kind'];
    dueDate: string;
    dueTime?: string | null;
    projectId?: string | null;
    paperId?: string | null;
    reviewId?: string | null;
  }): Promise<Deadline> {
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
      updatedAt: now(),
    };
    const { error } = await this.sb.from('deadlines').insert(deadlineToRow(deadline));
    if (error) throw new Error(`createDeadline: ${error.message}`);
    return deadline;
  }

  async updateDeadline(id: string, patch: Partial<Omit<Deadline, 'id'>>): Promise<Deadline> {
    const { data, error } = await this.sb
      .from('deadlines')
      .update({ ...deadlineToRow(patch as Deadline), updated_at: now() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) notFound('Deadline', id);
    return deadlineFromRow(data);
  }

  // --- milestones ---

  listMilestones(): Promise<Milestone[]> {
    return this.selectAll('milestones', milestoneFromRow);
  }

  async createMilestone(input: {
    projectId: string;
    title: string;
    startDate?: string | null;
    endDate?: string | null;
    status?: MilestoneStatus;
  }): Promise<Milestone> {
    const siblings = await this.sb
      .from('milestones')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', input.projectId);
    const milestone: Milestone = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      status: input.status ?? 'planned',
      sort: siblings.count ?? 0,
      updatedAt: now(),
    };
    const { error } = await this.sb.from('milestones').insert(milestoneToRow(milestone));
    if (error) throw new Error(`createMilestone: ${error.message}`);
    return milestone;
  }

  async updateMilestone(id: string, patch: Partial<Omit<Milestone, 'id' | 'projectId'>>): Promise<Milestone> {
    const { data, error } = await this.sb
      .from('milestones')
      .update({ ...milestoneToRow(patch as Milestone), updated_at: now() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) notFound('Milestone', id);
    return milestoneFromRow(data);
  }

  // --- tasks ---

  listTasks(): Promise<Task[]> {
    return this.selectAll('tasks', taskFromRow);
  }

  async createTask(input: {
    projectId?: string | null;
    milestoneId?: string | null;
    title: string;
    description?: string | null;
    dueDate?: string | null;
    status?: TaskStatus;
    assignee?: Assignee;
  }): Promise<Task> {
    const status = input.status ?? 'todo';
    const projectId = input.projectId ?? null;
    let siblingsQuery = this.sb.from('tasks').select('id', { count: 'exact', head: true }).eq('status', status);
    siblingsQuery = projectId ? siblingsQuery.eq('project_id', projectId) : siblingsQuery.is('project_id', null);
    const { count } = await siblingsQuery;
    const n = now();
    const task: Task = {
      id: randomUUID(),
      projectId,
      milestoneId: input.milestoneId ?? null,
      title: input.title,
      description: input.description ?? null,
      status,
      dueDate: input.dueDate ?? null,
      doneAt: status === 'done' ? n : null,
      assignee: input.assignee ?? 'me',
      sort: count ?? 0,
      createdAt: n,
      updatedAt: n,
    };
    const { error } = await this.sb.from('tasks').insert(taskToRow(task));
    if (error) throw new Error(`createTask: ${error.message}`);
    return task;
  }

  async updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): Promise<Task> {
    const n = now();
    const row: Record<string, unknown> = { ...taskToRow(patch as Task), updated_at: n };
    if (patch.status === 'done' && patch.doneAt === undefined) row.done_at = n;
    if (patch.status && patch.status !== 'done' && patch.doneAt === undefined) row.done_at = null;
    const { data, error } = await this.sb.from('tasks').update(row).eq('id', id).select().single();
    if (error || !data) notFound('Task', id);
    return taskFromRow(data);
  }

  async moveTask(id: string, toStatus: TaskStatus, toIndex: number): Promise<Task[]> {
    const tasks = await this.listTasks();
    const next = moveTaskLogic(tasks, id, toStatus, toIndex);
    const diffs = next.filter((t) => {
      const before = tasks.find((b) => b.id === t.id);
      return !before || before.status !== t.status || before.sort !== t.sort;
    });
    if (diffs.length > 0) {
      const { error } = await this.sb.rpc('reorder_tasks', {
        p_updates: diffs.map((t) => ({ id: t.id, status: t.status, sort: t.sort })),
        p_now: now(),
      });
      if (error) throw new Error(`moveTask: ${error.message}`);
    }
    return next;
  }

  async convertNoteToTask(
    noteId: string,
    input: { projectId: string; milestoneId?: string | null; title: string; dueDate?: string | null }
  ): Promise<Task> {
    const notes = await this.sb.from('notes').select('body').eq('id', noteId).single();
    if (notes.error || !notes.data) notFound('Note', noteId);
    const n = now();
    const task: Task = {
      id: randomUUID(),
      projectId: input.projectId,
      milestoneId: input.milestoneId ?? null,
      title: input.title,
      description: notes.data.body as string,
      status: 'todo',
      dueDate: input.dueDate ?? null,
      doneAt: null,
      assignee: 'me',
      sort: 0, // recomputed inside the RPC
      createdAt: n,
      updatedAt: n,
    };
    const { error } = await this.sb.rpc('convert_note_to_task', {
      p_task_id: task.id,
      p_project_id: task.projectId,
      p_milestone_id: task.milestoneId,
      p_title: task.title,
      p_description: task.description,
      p_due_date: task.dueDate,
      p_now: n,
      p_note_id: noteId,
    });
    if (error) throw new Error(`convertNoteToTask: ${error.message}`);
    return task;
  }

  // --- machine APIs: cloud status cache + cron heartbeat ---

  async getStatusSnapshot(): Promise<StatusSnapshot | null> {
    const { data, error } = await this.sb.from('status_snapshot').select('*').eq('id', 'latest').maybeSingle();
    if (error) throw new Error(`getStatusSnapshot: ${error.message}`);
    if (!data) return null;
    return { items: Array.isArray(data.items) ? data.items : [], collectedAt: data.collected_at as string };
  }

  async setStatusSnapshot(snapshot: StatusSnapshot): Promise<void> {
    const { error } = await this.sb
      .from('status_snapshot')
      .upsert({ id: 'latest', items: snapshot.items, collected_at: snapshot.collectedAt }, { onConflict: 'id' });
    if (error) throw new Error(`setStatusSnapshot: ${error.message}`);
  }

  async getHeartbeat(): Promise<string | null> {
    const { data, error } = await this.sb.from('heartbeat').select('at').eq('id', 1).maybeSingle();
    if (error) throw new Error(`getHeartbeat: ${error.message}`);
    return (data?.at as string | undefined) ?? null;
  }

  async setHeartbeat(at: string): Promise<void> {
    const { error } = await this.sb.from('heartbeat').upsert({ id: 1, at }, { onConflict: 'id' });
    if (error) throw new Error(`setHeartbeat: ${error.message}`);
  }
}
