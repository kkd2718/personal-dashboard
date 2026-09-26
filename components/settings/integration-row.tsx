import type { IntegrationHealth } from '@/lib/logic/integrations';

const DOT: Record<IntegrationHealth, string> = {
  ok: 'bg-success',
  stale: 'bg-warn',
  unknown: 'bg-foreground/20',
};

/** One 연동 상태 row (ux-advice.md §5.8): a health dot + name + last-seen sentence. */
export function IntegrationRow({
  name,
  health,
  sentence,
}: {
  name: string;
  health: IntegrationHealth;
  sentence: string;
}) {
  return (
    <li className="flex items-center gap-2.5 py-2 text-sm">
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[health]}`} aria-hidden />
      <span className="w-24 shrink-0 font-medium">{name}</span>
      <span className="min-w-0 flex-1 truncate text-foreground/60">{sentence}</span>
    </li>
  );
}
