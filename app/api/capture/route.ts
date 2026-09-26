import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkBearer } from '@/lib/auth/bearer';
import { createNoteFromText } from '@/lib/create-note';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  text: z.string().trim().min(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  externalId: z.string().trim().min(1).max(200).optional(),
  source: z.enum(['shortcut', 'obsidian']).default('shortcut'),
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

  const note = await createNoteFromText(
    parsed.data.text,
    parsed.data.date,
    parsed.data.source,
    parsed.data.externalId
  );

  return NextResponse.json({ ok: true, id: note.id, projectId: note.projectId, tags: note.tags });
}
