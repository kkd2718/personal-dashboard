import { NextResponse } from 'next/server';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';

export const dynamic = 'force-dynamic';

/** For scripts/collector.mjs: tells the PC which projects to probe. Bearer-token auth (INGEST_TOKEN,
 * same token as POST /api/ingest — both belong to the same PC-side collector). */
export async function GET(request: Request) {
  const auth = checkBearer(request, process.env.INGEST_TOKEN);
  if (auth === 'missing-config') {
    return NextResponse.json({ ok: false, error: 'INGEST_TOKEN not configured' }, { status: 503 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const repo = getRepo();
  const projects = await repo.listProjects();
  const active = projects
    .filter((p) => p.status === 'active' || p.status === 'paused')
    .map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      paths: p.paths,
      backlogGlobs: p.backlogGlobs,
    }));

  return NextResponse.json({ projects: active });
}
