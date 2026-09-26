import { NextResponse } from 'next/server';
import { getRepo } from '@/lib/repo';
import { getStatusPanelData } from '@/lib/status';

export const dynamic = 'force-dynamic';

/** Client refresh button target — same source the home page renders server-side. */
export async function GET() {
  const repo = getRepo();
  const projects = await repo.listProjects();
  const data = await getStatusPanelData(repo, projects);
  return NextResponse.json(data);
}
