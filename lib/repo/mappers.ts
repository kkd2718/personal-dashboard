// Pure row <-> domain-object mappers for SupabaseRepo. No Supabase client import
// here so these stay unit-testable without a network connection. `fromRow`
// tolerates missing/null jsonb columns (defaults to [] / {} / null) so a row
// written by an older migration never crashes the app.
import type {
  Assignee,
  CalendarEvent,
  Deadline,
  DeadlineKind,
  LinkRef,
  Milestone,
  MilestoneStatus,
  Note,
  NoteKind,
  NoteStatus,
  Paper,
  PaperStage,
  PaperSubmission,
  Project,
  ProjectActivity,
  ProjectStatus,
  ReviewCandidate,
  ReviewCandidateKind,
  ReviewCandidateStatus,
  ReviewJob,
  ReviewStatus,
  Task,
  TaskStatus,
} from '@/lib/types';

export type Row = Record<string, unknown>;

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function projectToRow(p: Project): Row {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    group: p.group,
    subgroup: p.subgroup,
    status: p.status,
    summary: p.summary,
    next_action: p.nextAction,
    links: p.links,
    paths: p.paths,
    aliases: p.aliases,
    backlog_globs: p.backlogGlobs,
    pinned: p.pinned,
    sort: p.sort,
    color: p.color,
    updated_at: p.updatedAt,
  };
}

export function projectFromRow(r: Row): Project {
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    group: r.group as Project['group'],
    subgroup: (r.subgroup as string | null) ?? null,
    status: r.status as ProjectStatus,
    summary: (r.summary as string) ?? '',
    nextAction: (r.next_action as string | null) ?? null,
    links: arr<LinkRef>(r.links),
    paths: arr<string>(r.paths),
    aliases: arr<string>(r.aliases),
    backlogGlobs: arr<string>(r.backlog_globs),
    pinned: Boolean(r.pinned),
    sort: (r.sort as number) ?? 0,
    color: (r.color as string) ?? 'blue',
    updatedAt: r.updated_at as string,
  };
}

export function milestoneToRow(m: Milestone): Row {
  return {
    id: m.id,
    project_id: m.projectId,
    title: m.title,
    start_date: m.startDate,
    end_date: m.endDate,
    status: m.status,
    sort: m.sort,
    updated_at: m.updatedAt,
  };
}

export function milestoneFromRow(r: Row): Milestone {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    title: r.title as string,
    startDate: (r.start_date as string | null) ?? null,
    endDate: (r.end_date as string | null) ?? null,
    status: r.status as MilestoneStatus,
    sort: (r.sort as number) ?? 0,
    updatedAt: r.updated_at as string,
  };
}

export function taskToRow(t: Task): Row {
  return {
    id: t.id,
    project_id: t.projectId,
    milestone_id: t.milestoneId,
    title: t.title,
    description: t.description,
    status: t.status,
    due_date: t.dueDate,
    done_at: t.doneAt,
    assignee: t.assignee,
    delivered_at: t.deliveredAt,
    sort: t.sort,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

export function taskFromRow(r: Row): Task {
  return {
    id: r.id as string,
    projectId: (r.project_id as string | null) ?? null,
    milestoneId: (r.milestone_id as string | null) ?? null,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    status: r.status as TaskStatus,
    dueDate: (r.due_date as string | null) ?? null,
    doneAt: (r.done_at as string | null) ?? null,
    assignee: (r.assignee as Assignee) ?? 'me',
    deliveredAt: (r.delivered_at as string | null) ?? null,
    sort: (r.sort as number) ?? 0,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function noteToRow(n: Note): Row {
  return {
    id: n.id,
    body: n.body,
    kind: n.kind,
    status: n.status,
    project_id: n.projectId,
    tags: n.tags,
    date: n.date,
    pinned: n.pinned,
    source: n.source,
    delivered_at: n.deliveredAt,
    task_id: n.taskId,
    external_id: n.externalId,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
  };
}

export function noteFromRow(r: Row): Note {
  return {
    id: r.id as string,
    body: r.body as string,
    kind: r.kind as NoteKind,
    status: r.status as NoteStatus,
    projectId: (r.project_id as string | null) ?? null,
    tags: arr<string>(r.tags),
    date: (r.date as string | null) ?? null,
    pinned: Boolean(r.pinned),
    source: r.source as Note['source'],
    deliveredAt: (r.delivered_at as string | null) ?? null,
    taskId: (r.task_id as string | null) ?? null,
    externalId: (r.external_id as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function paperToRow(p: Paper): Row {
  return {
    id: p.id,
    title: p.title,
    short_name: p.shortName,
    stage: p.stage,
    track: p.track,
    journal: p.journal,
    manuscript_id: p.manuscriptId,
    target_journals: p.targetJournals,
    folder_path: p.folderPath,
    next_action: p.nextAction,
    project_id: p.projectId,
    submissions: p.submissions,
    sort: p.sort,
    updated_at: p.updatedAt,
  };
}

export function paperFromRow(r: Row): Paper {
  return {
    id: r.id as string,
    title: r.title as string,
    shortName: r.short_name as string,
    stage: r.stage as PaperStage,
    track: r.track as Paper['track'],
    journal: (r.journal as string | null) ?? null,
    manuscriptId: (r.manuscript_id as string | null) ?? null,
    targetJournals: arr<string>(r.target_journals),
    folderPath: (r.folder_path as string | null) ?? null,
    nextAction: (r.next_action as string | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    submissions: arr<PaperSubmission>(r.submissions),
    sort: (r.sort as number) ?? 0,
    updatedAt: r.updated_at as string,
  };
}

export function reviewToRow(rv: ReviewJob): Row {
  return {
    id: rv.id,
    journal: rv.journal,
    manuscript_id: rv.manuscriptId,
    title: rv.title,
    status: rv.status,
    invited_at: rv.invitedAt,
    due_date: rv.dueDate,
    link: rv.link,
    note: rv.note,
    updated_at: rv.updatedAt,
  };
}

export function reviewFromRow(r: Row): ReviewJob {
  return {
    id: r.id as string,
    journal: r.journal as string,
    manuscriptId: (r.manuscript_id as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    status: r.status as ReviewStatus,
    invitedAt: (r.invited_at as string | null) ?? null,
    dueDate: (r.due_date as string | null) ?? null,
    link: (r.link as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    updatedAt: r.updated_at as string,
  };
}

export function deadlineToRow(d: Deadline): Row {
  return {
    id: d.id,
    title: d.title,
    kind: d.kind,
    due_date: d.dueDate,
    due_time: d.dueTime,
    project_id: d.projectId,
    paper_id: d.paperId,
    review_id: d.reviewId,
    done: d.done,
    remind_days: d.remindDays,
    updated_at: d.updatedAt,
  };
}

export function deadlineFromRow(r: Row): Deadline {
  return {
    id: r.id as string,
    title: r.title as string,
    kind: r.kind as DeadlineKind,
    dueDate: r.due_date as string,
    dueTime: (r.due_time as string | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    paperId: (r.paper_id as string | null) ?? null,
    reviewId: (r.review_id as string | null) ?? null,
    done: Boolean(r.done),
    remindDays: arr<number>(r.remind_days).length > 0 ? arr<number>(r.remind_days) : [7, 3, 1],
    updatedAt: r.updated_at as string,
  };
}

export function projectActivityToRow(a: ProjectActivity): Row {
  return {
    project_id: a.projectId,
    branch: a.branch,
    last_commit_at: a.lastCommitAt,
    last_commit_msg: a.lastCommitMsg,
    dirty: a.dirty,
    last_session_at: a.lastSessionAt,
    memory_digest: a.memoryDigest,
    metrics: a.metrics,
    collected_at: a.collectedAt,
  };
}

export function projectActivityFromRow(r: Row): ProjectActivity {
  return {
    projectId: r.project_id as string,
    branch: (r.branch as string | null) ?? null,
    lastCommitAt: (r.last_commit_at as string | null) ?? null,
    lastCommitMsg: (r.last_commit_msg as string | null) ?? null,
    dirty: (r.dirty as boolean | null) ?? null,
    lastSessionAt: (r.last_session_at as string | null) ?? null,
    memoryDigest: (r.memory_digest as string | null) ?? null,
    metrics: (r.metrics as Record<string, number | string>) ?? {},
    collectedAt: r.collected_at as string,
  };
}

export function calendarEventToRow(e: CalendarEvent): Row {
  return {
    id: e.id,
    account: e.account,
    calendar_name: e.calendarName,
    title: e.title,
    start_date: e.startDate,
    end_date: e.endDate,
    start_time: e.startTime,
    end_time: e.endTime,
    location: e.location,
    updated_at: e.updatedAt,
  };
}

export function calendarEventFromRow(r: Row): CalendarEvent {
  return {
    id: r.id as string,
    account: r.account as string,
    calendarName: r.calendar_name as string,
    title: r.title as string,
    startDate: r.start_date as string,
    endDate: r.end_date as string,
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    updatedAt: r.updated_at as string,
  };
}

export function reviewCandidateToRow(c: ReviewCandidate): Row {
  return {
    id: c.id,
    account: c.account,
    message_id: c.messageId,
    received_at: c.receivedAt,
    from_addr: c.fromAddr,
    subject: c.subject,
    snippet: c.snippet,
    kind: c.kind,
    journal: c.journal,
    manuscript_id: c.manuscriptId,
    title: c.title,
    due_date: c.dueDate,
    link: c.link,
    status: c.status,
    review_id: c.reviewId,
    revision_type: c.revisionType,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

export function reviewCandidateFromRow(r: Row): ReviewCandidate {
  return {
    id: r.id as string,
    account: r.account as string,
    messageId: r.message_id as string,
    receivedAt: r.received_at as string,
    fromAddr: r.from_addr as string,
    subject: r.subject as string,
    snippet: r.snippet as string,
    kind: r.kind as ReviewCandidateKind,
    journal: (r.journal as string | null) ?? null,
    manuscriptId: (r.manuscript_id as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    dueDate: (r.due_date as string | null) ?? null,
    link: (r.link as string | null) ?? null,
    status: r.status as ReviewCandidateStatus,
    reviewId: (r.review_id as string | null) ?? null,
    revisionType: (r.revision_type as 'major' | 'minor' | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}
