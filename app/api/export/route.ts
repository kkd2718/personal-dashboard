import { NextResponse } from 'next/server';
import { getRepo } from '@/lib/repo';
import { requireUser } from '@/lib/auth/require-user';

export const dynamic = 'force-dynamic';

/** Full JSON dump of every table, same shape as .data/db.json — session required.
 * Weekly manual/scripted runs are the backup story on Supabase's free tier (no
 * automated backups there). See docs/reviews/plan-advice.md §3. */
export async function GET() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const repo = getRepo();
  const [projects, projectActivity, papers, reviews, deadlines, notes, milestones, tasks, statusSnapshot, heartbeatAt] =
    await Promise.all([
      repo.listProjects(),
      repo.listProjectActivity(),
      repo.listPapers(),
      repo.listReviews(),
      repo.listDeadlines(),
      repo.listNotes(),
      repo.listMilestones(),
      repo.listTasks(),
      repo.getStatusSnapshot(),
      repo.getHeartbeat(),
    ]);

  const db = { projects, projectActivity, papers, reviews, deadlines, notes, milestones, tasks, statusSnapshot, heartbeatAt };

  return new NextResponse(JSON.stringify(db, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="command-center-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
