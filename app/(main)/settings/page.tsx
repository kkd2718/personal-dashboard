import { Settings as SettingsIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

// Full settings (연동 상태/데이터/표시/계정) ship in slice 4 (ux-advice.md §5.8).
// This placeholder exists so the sidebar/nav link + `/settings` route work now.
export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">설정</h1>
      <div className="rounded-[var(--r-md)] border border-border bg-surface p-4">
        <EmptyState>
          <span className="flex items-center gap-1.5">
            <SettingsIcon size={14} />
            설정은 곧 추가돼요.
          </span>
        </EmptyState>
      </div>
    </div>
  );
}
