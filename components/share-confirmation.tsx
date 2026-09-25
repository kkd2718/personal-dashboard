'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Undo2 } from 'lucide-react';
import { updateNoteAction } from '@/app/actions/notes';

export function ShareConfirmation({ noteId, body }: { noteId: string; body: string }) {
  const router = useRouter();
  const [undone, setUndone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (undone) {
    return <p className="text-sm text-foreground/60">메모를 취소했습니다.</p>;
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-emerald-600">
        <Check size={18} />
        <span className="font-medium">인박스에 저장했습니다</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground/70">{body}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await updateNoteAction({ id: noteId, status: 'archived' });
            setUndone(true);
          })
        }
        className="flex w-fit items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm"
      >
        <Undo2 size={14} />
        실행 취소
      </button>
      <button
        type="button"
        onClick={() => router.push('/inbox')}
        className="w-fit text-sm text-blue-600 hover:underline"
      >
        인박스로 이동
      </button>
    </div>
  );
}
