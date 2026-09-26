'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createPaperAction } from '@/app/actions/papers';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import type { Paper, PaperStage } from '@/lib/types';

const TRACKS: Paper['track'][] = ['AI', '역학', '개인연구', '기타'];
const STAGES: { key: PaperStage; label: string }[] = [
  { key: 'idea', label: '아이디어' },
  { key: 'writing', label: '작성중' },
];

/** "+ 논문" button + sheet (ux-advice.md §5.5, previously missing from the UI). */
export function NewPaperSheet() {
  const [open, setOpen] = useState(false);
  const [shortName, setShortName] = useState('');
  const [title, setTitle] = useState('');
  const [track, setTrack] = useState<Paper['track']>('AI');
  const [stage, setStage] = useState<PaperStage>('idea');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!shortName.trim() || !title.trim()) return;
    startTransition(async () => {
      await createPaperAction({ shortName: shortName.trim(), title: title.trim(), track, stage });
      setShortName('');
      setTitle('');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} /> 논문
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="새 논문">
        <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            짧은 이름
            <input
              autoFocus
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              className="rounded-md border border-border bg-transparent px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            제목
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-md border border-border bg-transparent px-2 py-1.5"
            />
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              트랙
              <select value={track} onChange={(e) => setTrack(e.target.value as Paper['track'])} className="rounded-md border border-border bg-transparent px-2 py-1.5">
                {TRACKS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              단계
              <select value={stage} onChange={(e) => setStage(e.target.value as PaperStage)} className="rounded-md border border-border bg-transparent px-2 py-1.5">
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button type="submit" variant="primary" disabled={pending || !shortName.trim() || !title.trim()} className="self-start">
            추가
          </Button>
        </form>
      </Sheet>
    </>
  );
}
