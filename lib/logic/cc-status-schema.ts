import { z } from 'zod';

/** Zod shape of a project's docs/cc-status.json (shared by /api/ingest and /api/agent-inbox/status). */
export const ccChecklistItemSchema = z.object({
  text: z.string().max(200),
  status: z.enum(['todo', 'doing', 'blocked', 'done']),
  section: z.string().max(40).nullable(),
  owner: z.enum(['me', 'agent']),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const ccStatusSchema = z.object({
  updatedAt: z.string().nullable(),
  focus: z.string().max(200).nullable(),
  next: z.array(z.string().max(200)).max(8),
  blockers: z.array(z.string().max(200)).max(8),
  done: z.array(z.object({ date: z.string().nullable(), text: z.string().max(200) })).max(10),
  checklist: z.array(ccChecklistItemSchema).max(120),
});
