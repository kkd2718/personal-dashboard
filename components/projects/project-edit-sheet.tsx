'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { ProjectEditForm } from '@/components/project-edit-form';
import type { Project } from '@/lib/types';

/** ✎ 편집 button + sheet (ux-advice.md §5.4): settings move out of the page body
 * so the first viewport is header + 지금 + task board, not a form. */
export function ProjectEditSheet({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-[var(--r-sm)] border border-border px-2.5 py-1.5 text-xs text-foreground/70 hover:bg-foreground/5"
      >
        <Pencil size={13} />
        편집
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`${project.name} 편집`}>
        <ProjectEditForm
          project={project}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      </Sheet>
    </>
  );
}
