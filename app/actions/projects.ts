'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import type { Project } from '@/lib/types';
import { revalidateAll } from '@/app/actions/revalidate';
import { requireUser } from '@/lib/auth/require-user';

const linkSchema = z.object({
  label: z.string().trim().min(1),
  url: z.string().trim().min(1),
  kind: z.enum(['public', 'local', 'tailscale', 'repo', 'folder']),
});

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['active', 'paused', 'done', 'archived']).optional(),
  summary: z.string().optional(),
  nextAction: z.string().nullable().optional(),
  links: z.array(linkSchema).optional(),
  aliases: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
});

export async function updateProjectAction(input: unknown): Promise<Project> {
  await requireUser();
  const { id, ...patch } = updateSchema.parse(input);
  const project = await getRepo().updateProject(id, patch);
  revalidateAll();
  return project;
}
