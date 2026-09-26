'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { filterPaletteEntries, type PaletteEntry } from '@/lib/logic/palette';
import { createNoteAction } from '@/app/actions/notes';
import { createTaskAction } from '@/app/actions/tasks';
import { createDeadlineAction } from '@/app/actions/deadlines';
import { logoutAction } from '@/app/actions/auth';
import { useToast } from '@/components/ui/toast';
import { todayKST } from '@/lib/logic/dates';

const KIND_LABEL: Record<PaletteEntry['kind'], string> = {
  page: '이동',
  project: '프로젝트',
  paper: '논문',
  review: '리뷰',
  create: '만들기',
  action: '동작',
};

function toggleTheme() {
  const dark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('cc-theme', dark ? 'dark' : 'light');
}

/**
 * ⌘K palette (ux-advice.md §4.1). `indexEntries` is the static server-built index
 * (pages/projects/papers/reviews); action/create rows are added here since they
 * need client-only handlers. No search API, no cmdk dependency (plan §7).
 */
export function CommandPalette({
  open,
  onClose,
  indexEntries,
}: {
  open: boolean;
  onClose: () => void;
  indexEntries: PaletteEntry[];
}) {
  const router = useRouter();
  const { show } = useToast();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingDeadline, setPendingDeadline] = useState<string | null>(null);
  const [deadlineDate, setDeadlineDate] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset palette state each time it opens
    setQuery('');
    setActiveIndex(0);
    setPendingDeadline(null);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the highlighted row in range as results change
    setActiveIndex(0);
  }, [query]);

  const actionEntries: PaletteEntry[] = useMemo(
    () => [
      { id: 'action:theme', label: '테마 전환', kind: 'action', action: 'theme' },
      { id: 'action:refresh', label: '상황 새로고침', kind: 'action', action: 'refresh' },
      { id: 'action:export', label: 'JSON 내보내기', kind: 'action', action: 'export' },
      { id: 'action:logout', label: '로그아웃', kind: 'action', action: 'logout' },
    ],
    []
  );

  const createEntries: PaletteEntry[] = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return [
      { id: 'create:memo', label: `메모: ${q}`, kind: 'create' },
      { id: 'create:task', label: `할 일: ${q}`, kind: 'create' },
      { id: 'create:deadline', label: `마감: ${q}`, kind: 'create' },
    ];
  }, [query]);

  const matched = useMemo(
    () => filterPaletteEntries([...indexEntries, ...actionEntries, ...createEntries], query, 8),
    [indexEntries, actionEntries, createEntries, query]
  );
  // No fuzzy match at all but the user typed something -> offer the create rows first.
  const results = matched.length > 0 || !query.trim() ? matched : createEntries;

  async function runEntry(entry: PaletteEntry) {
    if (entry.href) {
      router.push(entry.href);
      onClose();
      return;
    }
    if (entry.kind === 'create') {
      const text = query.trim();
      if (!text) return;
      if (entry.id === 'create:memo') {
        await createNoteAction({ body: text, kind: 'memo', source: 'web' });
        show('메모 저장됨', { variant: 'success' });
        router.refresh();
        onClose();
      } else if (entry.id === 'create:task') {
        await createTaskAction({ title: text, assignee: 'me' });
        show('할 일 추가됨', { variant: 'success' });
        router.refresh();
        onClose();
      } else if (entry.id === 'create:deadline') {
        setPendingDeadline(text);
        setDeadlineDate(todayKST());
      }
      return;
    }
    if (entry.kind === 'action') {
      switch (entry.action) {
        case 'theme':
          toggleTheme();
          onClose();
          break;
        case 'refresh':
          router.refresh();
          show('새로고침했어요');
          onClose();
          break;
        case 'export':
          window.open('/api/export', '_blank');
          onClose();
          break;
        case 'logout':
          onClose();
          logoutAction();
          break;
      }
    }
  }

  async function submitDeadline(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingDeadline || !deadlineDate) return;
    await createDeadlineAction({ title: pendingDeadline, kind: 'other', dueDate: deadlineDate });
    show('마감 추가됨', { variant: 'success' });
    router.refresh();
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = results[activeIndex];
      if (entry) runEntry(entry);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="명령 팔레트"
        className="mx-auto flex h-dvh w-full flex-col bg-surface md:mt-24 md:h-auto md:max-h-[70vh] md:w-[560px] md:rounded-[var(--r-lg)] md:border md:border-border md:shadow-[var(--shadow-sheet)]"
      >
        {pendingDeadline ? (
          <form onSubmit={submitDeadline} className="flex flex-col gap-2 p-3">
            <p className="text-sm text-foreground/70">마감: {pendingDeadline}</p>
            <input
              type="date"
              autoFocus
              value={deadlineDate}
              onChange={(e) => setDeadlineDate(e.target.value)}
              className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-foreground/60">
                취소
              </button>
              <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-sm text-white">
                추가
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-border p-3">
              <Search size={16} className="shrink-0 text-foreground/40" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="이동, 만들기, 동작..."
                className="min-w-0 flex-1 bg-transparent text-[16px] outline-none md:text-sm"
              />
              <kbd className="hidden shrink-0 rounded border border-border px-1 text-[10px] text-foreground/40 md:inline">
                Esc
              </kbd>
            </div>
            <ul className="flex-1 overflow-y-auto p-1.5">
              {results.length === 0 && <li className="p-3 text-sm text-foreground/40">일치하는 항목이 없어요.</li>}
              {results.map((entry, i) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => runEntry(entry)}
                    className={`flex w-full items-center gap-2 rounded-[var(--r-sm)] px-2.5 py-2 text-left text-sm ${
                      i === activeIndex ? 'bg-accent-soft text-accent' : 'hover:bg-foreground/5'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {entry.sublabel && (
                      <span className="shrink-0 truncate text-xs text-foreground/40">{entry.sublabel}</span>
                    )}
                    <span className="shrink-0 rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] text-foreground/50">
                      {KIND_LABEL[entry.kind]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
