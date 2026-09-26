'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Bottom sheet on mobile / centered dialog on desktop (ux-advice.md §4.6). Portal,
 * backdrop, drag handle, `max-h-[85dvh]`, safe-area bottom padding. Esc/backdrop
 * click to close; focus moves in on open and returns to the trigger on close.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    panelRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div
        className="fixed inset-0 bg-black/40 [transition:opacity_220ms_var(--ease,cubic-bezier(.2,.8,.2,1))] motion-reduce:transition-none"
        aria-hidden
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 flex max-h-[85dvh] w-full flex-col overflow-y-auto rounded-t-[var(--r-lg)] border border-border bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-sheet)] outline-none md:max-h-[80vh] md:w-[480px] md:rounded-[var(--r-lg)]"
      >
        <div className="mb-2 flex shrink-0 items-center justify-center md:hidden">
          <span className="h-1 w-9 rounded-full bg-border-strong" aria-hidden />
        </div>
        {title && (
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-md font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="rounded-md p-1 text-foreground/50 hover:bg-foreground/5"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}
