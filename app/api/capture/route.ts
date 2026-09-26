import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';
import { captureNoteInput } from '@/lib/logic/capture';
import { tagCounts } from '@/lib/logic/notes';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  text: z.string().trim().min(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** For the iOS Shortcut / share sheet. Bearer-token auth (CAPTURE_TOKEN), not a user session. */
export async function POST(request: Request) {
  const auth = checkBearer(request, process.env.CAPTURE_TOKEN);
  if (auth === 'missing-config') {
    return NextResponse.json({ ok: false, error: 'CAPTURE_TOKEN not configured' }, { status: 503 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }

  const repo = getRepo();
  const [projects, notes] = await Promise.all([repo.listProjects(), repo.listNotes()]);
  const input = captureNoteInput(parsed.data.text, parsed.data.date, projects, tagCounts(notes).map((t) => t.tag));
  const note = await repo.createNote(input);

  return NextResponse.json({ ok: true, id: note.id, projectId: note.projectId, tags: note.tags });
}
