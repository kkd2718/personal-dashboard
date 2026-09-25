'use client';

import { useState, useTransition } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { createNoteAction } from '@/app/actions/notes';

/** Always-on-top capture box: type and hit enter to drop a memo into the inbox. */
export function QuickCapture() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = value.trim();
    if (!body) return;
    startTransition(async () => {
      try {
        await createNoteAction({ body, kind: 'memo', source: 'web' });
        setValue('');
        setError(null);
      } catch {
        setError('저장하지 못했습니다. 다시 시도해 주세요.');
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2 rounded-xl border border-border bg-surface p-2 shadow-sm"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="빠르게 메모나 아이디어를 적어보세요..."
        className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-foreground/40"
      />
      <button
        type="submit"
        disabled={pending || !value.trim()}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition disabled:opacity-40"
        aria-label="메모 추가"
      >
        {pending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
      </button>
      {error && <span className="absolute mt-12 text-xs text-red-600">{error}</span>}
    </form>
  );
}
