import type { ReactNode } from 'react';
import { BottomNav, Sidebar } from '@/components/nav';

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh md:flex-row">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 md:px-8 md:py-8">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
