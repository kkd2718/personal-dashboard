import { Sheet } from '@/components/ui/sheet';

const ROWS: { keys: string; label: string }[] = [
  { keys: '⌘K / Ctrl K', label: '명령 팔레트' },
  { keys: 'c', label: '빠른 메모 열기' },
  { keys: 'g h', label: '홈으로 이동' },
  { keys: 'g m', label: '메모로 이동' },
  { keys: 'g p', label: '프로젝트로 이동' },
  { keys: 'g l', label: '논문으로 이동' },
  { keys: 'g c', label: '캘린더로 이동' },
  { keys: '?', label: '이 단축키 목록' },
  { keys: 'Esc', label: '닫기' },
];

/** `?` shortcut sheet (ux-advice.md §4.2). */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="단축키">
      <ul className="flex flex-col gap-1.5 text-sm">
        {ROWS.map((row) => (
          <li key={row.keys} className="flex items-center justify-between gap-3">
            <span className="text-foreground/70">{row.label}</span>
            <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-foreground/60">
              {row.keys}
            </kbd>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-foreground/40">입력 중일 때는 단축키가 동작하지 않아요.</p>
    </Sheet>
  );
}
