'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Merge, Pencil } from 'lucide-react';
import { mergeTagAction } from '@/app/actions/notes';
import { Popover } from '@/components/ui/popover';

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

/**
 * "태그 ▾" popover next to the /memo filters (ux-advice.md §5.2): rename a tag,
 * or merge it into another (single write, all notes) — replaces the old
 * always-visible 태그 관리 card.
 */
export function TagManager({ tags }: { tags: TagRow[] }) {
  const [open, setOpen] = useState(false);
  if (tags.length === 0) return null;
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-sm hover:bg-foreground/5"
        >
          태그 <ChevronDown size={14} />
        </button>
      }
    >
      <ul className="flex max-h-72 w-64 flex-col gap-1 overflow-y-auto text-xs">
        {tags.map(({ tag, count }) => (
          <li key={tag} className="flex items-center justify-between gap-1.5 px-1 py-0.5">
            <span>
              #{tag} <span className="text-foreground/40">({count})</span>
            </span>
            <TagActions tag={tag} others={tags.map((t) => t.tag).filter((t) => t !== tag)} />
          </li>
        ))}
      </ul>
    </Popover>
  );
}
