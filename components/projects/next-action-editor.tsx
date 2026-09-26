'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { updateProjectAction } from '@/app/actions/projects';
import { useToast } from '@/components/ui/toast';

/** Inline-editable "다음 액션" (ux-advice.md §4.3): click title -> field, ↵ saves,
 * Esc cancels, blur saves. */
export function NextActionEditor({ projectId, nextAction }: { projectId: string; nextAction: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(nextAction ?? '');
  const router = useRouter();
  const { show } = useToast();

  function save() {
    setEditing(false);
    const next = value.trim() || null;
    if (next === nextAction) return;
    updateProjectAction({ id: projectId, nextAction: next })
      .then(() => router.refresh())
      .catch(() => {
        setValue(nextAction ?? '');
        show('저장하지 못했어요. 다시 시도해 주세요.', { variant: 'danger' });
      });
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') {
            setValue(nextAction ?? '');
            setEditing(false);
          }
        }}
        className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-sm hover:bg-foreground/5"
    >
      <span className={nextAction ? '' : 'text-foreground/40'}>{nextAction ?? '다음 액션을 정해보세요'}</span>
      <Pencil size={12} className="shrink-0 text-foreground/30 opacity-0 group-hover:opacity-100" />
    </button>
  );
}
