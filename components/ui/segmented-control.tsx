/** Tab-like control for mutually exclusive views (파이프라인|리뷰, 월|주, ...). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex gap-1 rounded-[var(--r-sm)] border border-border p-0.5 text-sm ${className}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
          className={`rounded-[calc(var(--r-sm)-2px)] px-2.5 py-1 transition ${
            opt.value === value ? 'bg-accent text-white' : 'text-foreground/70 hover:bg-foreground/5'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
