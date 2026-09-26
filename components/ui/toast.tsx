'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';

type Variant = 'default' | 'success' | 'danger';

interface ToastOptions {
  variant?: Variant;
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

interface ToastState extends ToastOptions {
  id: number;
  message: string;
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 4000;

const ICON: Record<Variant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  danger: XCircle,
};

const TONE: Record<Variant, string> = {
  default: 'border-border bg-surface text-foreground',
  success: 'border-success/30 bg-surface text-success',
  danger: 'border-danger/30 bg-surface text-danger',
};

/**
 * Global toast host (ux-advice.md §4.4): bottom-center on desktop, above the
 * mobile bottom nav. At most one visible at a time; pauses its timer on hover.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      clear();
      const id = ++idRef.current;
      setToast({ id, message, ...options });
      timerRef.current = setTimeout(() => {
        setToast((cur) => (cur?.id === id ? null : cur));
      }, options.durationMs ?? DEFAULT_DURATION);
    },
    [clear]
  );

  const Icon = toast ? ICON[toast.variant ?? 'default'] : Info;

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div
          className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 md:bottom-6"
          onMouseEnter={clear}
          onMouseLeave={() => {
            timerRef.current = setTimeout(() => setToast(null), toast.durationMs ?? DEFAULT_DURATION);
          }}
        >
          <div
            role="status"
            className={`flex items-center gap-2 rounded-[var(--r-md)] border px-3 py-2 text-sm shadow-[var(--shadow-popover)] dark:shadow-none ${TONE[toast.variant ?? 'default']}`}
          >
            <Icon size={16} className="shrink-0" />
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  setToast(null);
                }}
                className="ml-1 shrink-0 font-medium text-accent hover:underline"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

/** Must be used within `ToastProvider` (mounted once in app/(main)/layout.tsx). */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
