import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:opacity-90',
  secondary: 'border border-border bg-surface text-foreground hover:bg-foreground/5',
  ghost: 'text-foreground/70 hover:bg-foreground/5',
  danger: 'bg-danger text-white hover:opacity-90',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
};

/** Base button primitive (ux-advice.md §3/§8 slice 1). No new deps: plain Tailwind. */
export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--r-sm)] font-medium transition disabled:pointer-events-none disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...props}
    />
  );
}
