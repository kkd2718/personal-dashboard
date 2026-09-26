'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Merge } from 'lucide-react';
import { mergeTagAction } from '@/app/actions/notes';

interface TagRow {
  tag: string;
  count: number;
}

function TagActions({ tag, others }: { tag: string; others: string[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'rename' | 'merge'>('idle');
  const [renameTo, setRenameTo] = useState(tag);
  const [mergeInto, setMergeInto] = useState(others[0] ?? '');
  const [pending, startTransition] = useTransition();

  function apply(to: string) {
    if (!to.trim() || to.trim() === tag) {
      setMode('idle');
      return;
    }
    startTransition(async () => {
      await mergeTagAction({ from: tag, to: to.trim() });
      router.refresh();
      setMode('idle');
    });
  }

  if (mode === 'rename') {
    return (
      <span className="flex items-center gap-1">
        <input
          autoFocus
          value={renameTo}
          onChange={(e) => setRenameTo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply(renameTo)}
          className="w-24 rounded border border-border bg-transparent px-1 py-0.5 text-xs"
        />
        <button type="button" disabled={pending} onClick={() => apply(renameTo)} className="text-xs text-blue-600">
          저장
        </button>
      </span>
    );
  }

  if (mode === 'merge') {
    return (
      <span className="flex items-center gap-1">
        <select
          value={mergeInto}
          onChange={(e) => setMergeInto(e.target.value)}
          className="rounded border border-border bg-transparent px-1 py-0.5 text-xs"
        >
          {others.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <button type="button" disabled={pending || !mergeInto} onClick={() => apply(mergeInto)} className="text-xs text-blue-600">
          병합
        </button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-foreground/40">
      <button type="button" title="이름 변경" onClick={() => setMode('rename')} className="hover:text-foreground/70">
        <Pencil size={12} />
      </button>
      {others.length > 0 && (
        <button type="button" title="다른 태그로 병합" onClick={() => setMode('merge')} className="hover:text-foreground/70">
          <Merge size={12} />
        </button>
      )}
    </span>
  );
}

/** Tag hygiene list for /memo: rename a tag, or merge it into another (single write, all notes). */
export function TagManager({ tags }: { tags: TagRow[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <h2 className="text-sm font-semibold">태그 관리</h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {tags.map(({ tag, count }) => (
          <li key={tag} className="flex items-center gap-1.5">
            <span>
              #{tag} <span className="text-foreground/40">({count})</span>
            </span>
            <TagActions tag={tag} others={tags.map((t) => t.tag).filter((t) => t !== tag)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
