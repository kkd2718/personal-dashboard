'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Lightweight anchored popover: renders `children` directly under `trigger` in
 * normal flow (no portal needed for the simple menus slice 1 introduces), closes
 * on outside click / Esc. Desktop only needs fade+rise (§3 motion); this is a
 * plain div so callers can add that via className.
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  className = '',
  align = 'start',
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={rootRef} className="relative inline-block">
      {trigger}
      {open && (
        <div
          role="dialog"
          className={`absolute z-30 mt-1 min-w-40 rounded-[var(--r-md)] border border-border bg-surface p-1.5 text-sm shadow-[var(--shadow-popover)] dark:shadow-none ${
            align === 'end' ? 'right-0' : 'left-0'
          } ${className}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
