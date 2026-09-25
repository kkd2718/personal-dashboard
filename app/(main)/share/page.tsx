import { redirect } from 'next/navigation';
import { getRepo } from '@/lib/repo';
import { parseShare } from '@/lib/logic/share';
import { ShareConfirmation } from '@/components/share-confirmation';

interface SearchParams {
  title?: string;
  text?: string;
  url?: string;
  created?: string;
}

export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const repo = getRepo();

  if (params.created) {
    const notes = await repo.listNotes();
    const note = notes.find((n) => n.id === params.created);
    if (!note) {
      return <p className="text-sm text-foreground/50">메모를 찾을 수 없습니다.</p>;
    }
    return <ShareConfirmation noteId={note.id} body={note.body} />;
  }

  if (!params.title && !params.text && !params.url) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">공유</h1>
        <p className="text-sm text-foreground/50">공유할 제목/텍스트/링크가 없습니다.</p>
      </div>
    );
  }

  let parsed;
  try {
    parsed = parseShare(params);
  } catch {
    return <p className="text-sm text-red-600">공유 내용이 비어 있어 저장하지 못했습니다.</p>;
  }

  const note = await repo.createNote({ body: parsed.body, kind: parsed.kind, source: 'share' });
  redirect(`/share?created=${note.id}`);
}
