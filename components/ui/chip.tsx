import type { HTMLAttributes } from 'react';

type Tone = 'neutral' | 'accent' | 'danger' | 'warn' | 'success';

const TONE: Record<Tone, string> = {
  neutral: 'bg-foreground/5 text-foreground/70',
  accent: 'bg-accent-soft text-accent',
  danger: 'bg-danger-soft text-danger',
  warn: 'bg-warn-soft text-warn',
  success: 'bg-success-soft text-success',
};

/** Small pill label — status/kind/tag chips (ux-advice.md §3: 22px tall, 12px text). */
export function Chip({
  tone = 'neutral',
  className = '',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={`chip inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-xs ${TONE[tone]} ${className}`}
      {...props}
    />
  );
}
