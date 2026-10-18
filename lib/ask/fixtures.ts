// Test-only fakes for the /ask tests: in-memory repo and a scripted Anthropic client.
import type Anthropic from '@anthropic-ai/sdk';
import type { Deadline, Note, Paper, Project, ReviewJob, Task } from '@/lib/types';
import type { AskClient, AskCreateParams } from '@/lib/ask/client';
import type { AskRunRepo } from '@/lib/ask/run';

interface Data {
  tasks?: Task[];
  deadlines?: Deadline[];
  projects?: Project[];
  papers?: Paper[];
  reviews?: ReviewJob[];
  notes?: Note[];
  meta?: Record<string, unknown>;
}

export function fakeRepo(d: Data = {}) {
  const meta = new Map<string, unknown>(Object.entries(d.meta ?? {}));
  const repo = {
    listTasks: async () => d.tasks ?? [],
    listDeadlines: async () => d.deadlines ?? [],
    listProjects: async () => d.projects ?? [],
    listPapers: async () => d.papers ?? [],
    listReviews: async () => d.reviews ?? [],
    listNotes: async () => d.notes ?? [],
    listCalendarEvents: async () => [],
    listProjectActivity: async () => [],
    getStatusSnapshot: async () => null,
    getMeta: async (k: string) => (meta.has(k) ? structuredClone(meta.get(k)) : null),
    setMeta: async (k: string, v: unknown) => void meta.set(k, structuredClone(v)),
    listMetaByPrefix: async (p: string) => Object.fromEntries([...meta].filter(([k]) => k.startsWith(p))),
    deleteMeta: async (k: string) => void meta.delete(k),
    claimMeta: async (k: string, v: unknown) => (meta.has(k) ? false : (meta.set(k, v), true)),
  };
  return { repo: repo as unknown as AskRunRepo, meta };
}

export const note = (o: Partial<Note> & { id: string; body: string }): Note => ({
  kind: 'memo',
  status: 'inbox',
  projectId: null,
  tags: [],
  date: null,
  pinned: false,
  source: 'web',
  deliveredAt: null,
  taskId: null,
  externalId: null,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
  ...o,
});

type Block = Anthropic.Messages.ContentBlock;
type Usage = Partial<Anthropic.Messages.Usage>;

export function message(content: unknown[], stop: string = 'end_turn', usage: Usage = {}): Anthropic.Messages.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: content as Block[],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...usage },
  } as unknown as Anthropic.Messages.Message;
}

export const text = (t: string) => ({ type: 'text', text: t });
export const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });

/** Scripted client: replies in order (the last one repeats); records a deep copy of each call's params. */
export function fakeClient(replies: Array<Anthropic.Messages.Message | ((p: AskCreateParams) => Anthropic.Messages.Message)>) {
  const calls: AskCreateParams[] = [];
  const client: AskClient = {
    create: async (params) => {
      calls.push(structuredClone(params));
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      return typeof r === 'function' ? r(params) : r;
    },
  };
  return { client, calls };
}
