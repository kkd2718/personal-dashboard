import { NextResponse } from 'next/server';
import { getRepo } from '@/lib/repo';
import { runStatusProbes } from '@/lib/status';

export const dynamic = 'force-dynamic';

/** Client refresh button target — same probes the home page runs server-side. */
export async function GET() {
  const projects = await getRepo().listProjects();
  const items = await runStatusProbes(projects);
  return NextResponse.json({ items, checkedAt: new Date().toISOString() });
}
