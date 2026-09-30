'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { saveRoutinesAction } from '@/app/actions/routines';
import type { RoutineItem } from '@/lib/logic/routines';

type Draft = Omit<RoutineItem, 'sort'>;

const INPUT = 'min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-sm';

/** 루틴 section: edit label/URL/dates, reorder with up/down, add/delete, save once. */
export function RoutineSettings({ items, today }: { items: RoutineItem[]; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Draft[]>(() => [...items].sort((a, b) => a.sort - b.sort));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function patch(i: number, p: Partial<Draft>) {
    setSaved(false);
    setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...p } : x)));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= drafts.length) return;
    setSaved(false);
    setDrafts((d) => {
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function add() {
    setSaved(false);
    setDrafts((d) => [
      ...d,
      { id: `r-${crypto.randomUUID().slice(0, 8)}`, label: '', url: null, startDate: today, endDate: null },
    ]);
  }
  function remove(i: number) {
    setSaved(false);
    setDrafts((d) => d.filter((_, j) => j !== i));
  }
  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveRoutinesAction(drafts);
        setSaved(true);
        router.refresh();
      } catch {
        setError('저장 실패: 이름 1–60자, URL은 http(s)://, 종료일은 시작일 이후, 최대 10개');
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {drafts.length === 0 && <p className="text-sm text-foreground/50">루틴이 없어요.</p>}
      <ul className="flex flex-col gap-2">
        {drafts.map((r, i) => (
          <li key={r.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-2">
            <div className="flex items-center gap-1.5">
              <input
                value={r.label}
                maxLength={60}
                onChange={(e) => patch(i, { label: e.target.value })}
                placeholder="루틴 이름"
                className={`${INPUT} flex-1`}
              />
              <button type="button" aria-label="위로" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1.5 hover:bg-foreground/5 disabled:opacity-30">
                <ArrowUp size={14} />
              </button>
              <button type="button" aria-label="아래로" onClick={() => move(i, 1)} disabled={i === drafts.length - 1} className="rounded p-1.5 hover:bg-foreground/5 disabled:opacity-30">
                <ArrowDown size={14} />
              </button>
              <button type="button" aria-label="삭제" onClick={() => remove(i)} className="rounded p-1.5 text-red-500 hover:bg-red-500/10">
                <Trash2 size={14} />
              </button>
            </div>
            <input
              value={r.url ?? ''}
              onChange={(e) => patch(i, { url: e.target.value })}
              placeholder="https:// (선택)"
              inputMode="url"
              className={INPUT}
            />
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-foreground/60">
              <label className="flex items-center gap-1">
                시작
                <input type="date" value={r.startDate} onChange={(e) => patch(i, { startDate: e.target.value })} className={INPUT} />
              </label>
              <label className="flex items-center gap-1">
                종료
                <input type="date" value={r.endDate ?? ''} onChange={(e) => patch(i, { endDate: e.target.value || null })} className={INPUT} />
              </label>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={add}
          disabled={drafts.length >= 10}
          className="flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-foreground/60 hover:bg-foreground/5 disabled:opacity-40"
        >
          <Plus size={12} /> 루틴 추가
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending || drafts.some((d) => !d.label.trim())}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-40"
        >
          저장
        </button>
        {saved && <span className="text-xs text-foreground/50">저장했어요</span>}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  );
}
