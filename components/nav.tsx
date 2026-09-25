'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarClock, FolderKanban, Home, Inbox, LayoutDashboard, Notebook } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

const NAV_ITEMS = [
  { href: '/', label: '홈', icon: Home },
  { href: '/inbox', label: '인박스', icon: Inbox },
  { href: '/projects', label: '프로젝트', icon: FolderKanban },
  { href: '/papers', label: '논문', icon: Notebook },
  { href: '/deadlines', label: '마감', icon: CalendarClock },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex items-center gap-2 px-5 py-5">
        <LayoutDashboard size={20} className="text-blue-600" />
        <span className="font-semibold">Command Center</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? 'bg-blue-600/10 font-medium text-blue-700 dark:text-blue-400'
                  : 'text-foreground/70 hover:bg-foreground/5'
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center justify-between px-5 py-4">
        <span className="text-xs text-foreground/50">Phase 1a</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
              active ? 'text-blue-600 dark:text-blue-400' : 'text-foreground/60'
            }`}
          >
            <Icon size={20} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
