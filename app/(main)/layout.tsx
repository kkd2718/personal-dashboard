import type { ReactNode } from 'react';
import { BottomNav, Sidebar } from '@/components/nav';
import { ToastProvider } from '@/components/ui/toast';
import { authConfigured } from '@/lib/auth/require-user';
import { getRepo } from '@/lib/repo';
import { tagCounts } from '@/lib/logic/notes';

export default async function MainLayout({ children }: { children: ReactNode }) {
  // Minimal data for the mobile capture FAB sheet, which needs to work from any route.
  const repo = getRepo();
  const [projects, notes] = await Promise.all([repo.listProjects(), repo.listNotes()]);
  const activeProjects = projects.filter((p) => p.status === 'active');

  return (
    <ToastProvider>
      <div className="flex min-h-dvh md:flex-row">
        <Sidebar authEnabled={authConfigured()} />
        <div className="flex min-w-0 flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
          <main className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-5 lg:px-6 md:py-8">{children}</main>
        </div>
        <BottomNav projects={activeProjects} existingTags={tagCounts(notes)} />
      </div>
    </ToastProvider>
  );
}
