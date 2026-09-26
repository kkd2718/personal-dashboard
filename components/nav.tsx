'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarClock,
  Command,
  FolderKanban,
  Home,
  LayoutDashboard,
  LogOut,
  NotebookText,
  Plus,
  Settings,
  StickyNote,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { logoutAction } from '@/app/actions/auth';
import { QuickCapture } from '@/components/quick-capture';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import type { Project } from '@/lib/types';

const NAV_ITEMS = [
  { href: '/', label: '홈', icon: Home },
  { href: '/memo', label: '메모', icon: StickyNote },
  { href: '/projects', label: '프로젝트', icon: FolderKanban },
  { href: '/papers', label: '논문', icon: NotebookText },
  { href: '/calendar', label: '캘린더', icon: CalendarClock },
] as const;

// Mobile keeps the phone thumb-first: no 논문 tab (reached via 프로젝트's segmented
// control instead, ux-advice.md §2), and a raised (+) capture button in the middle.
const MOBILE_NAV_ITEMS = [
  { href: '/', label: '홈', icon: Home },
  { href: '/memo', label: '메모', icon: StickyNote },
  { href: '/projects', label: '프로젝트', icon: FolderKanban },
  { href: '/calendar', label: '캘린더', icon: CalendarClock },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}

export function Sidebar({ authEnabled = false }: { authEnabled?: boolean }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex items-center gap-2 px-5 py-5">
        <LayoutDashboard size={20} className="text-accent" />
        <span className="font-semibold">Command Center</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-[var(--r-sm)] px-3 py-2 text-sm transition ${
                active ? 'bg-accent-soft font-medium text-accent' : 'text-foreground/70 hover:bg-foreground/5'
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('cc:open-palette'))}
          className="flex items-center gap-3 rounded-[var(--r-sm)] px-3 py-2 text-left text-sm text-foreground/50 hover:bg-foreground/5"
        >
          <Command size={16} />
          검색·명령
          <kbd className="ml-auto rounded border border-border px-1 text-[10px] text-foreground/40">⌘K</kbd>
        </button>
        <div className="flex items-center justify-between px-1">
          <Link
            href="/settings"
            className={`flex items-center gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-sm ${
              isActive(pathname, '/settings') ? 'font-medium text-accent' : 'text-foreground/70 hover:bg-foreground/5'
            }`}
          >
            <Settings size={16} />
            설정
          </Link>
          <div className="flex items-center gap-1">
            {authEnabled && (
              <button
                type="button"
                onClick={() => logoutAction()}
                aria-label="로그아웃"
                className="rounded-md p-1.5 text-foreground/50 hover:bg-foreground/5"
              >
                <LogOut size={16} />
              </button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </div>
    </aside>
  );
}

/** Mobile-only FAB that opens the capture sheet with the existing QuickCapture. */
function CaptureButton({
  projects,
  existingTags,
}: {
  projects: Project[];
  existingTags: { tag: string; count: number }[];
}) {
  const [open, setOpen] = useState(false);
  const { show } = useToast();

  // 'c' shortcut (components/shortcuts-provider.tsx) opens this sheet from any page.
  useEffect(() => {
    function onFocusCapture() {
      setOpen(true);
    }
    window.addEventListener('cc:focus-capture', onFocusCapture);
    return () => window.removeEventListener('cc:focus-capture', onFocusCapture);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="메모 작성"
        className="relative -top-3 flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-[var(--shadow-popover)] dark:shadow-none"
      >
        <Plus size={24} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="빠른 메모">
        <QuickCapture
          projects={projects}
          existingTags={existingTags}
          autoFocus
          onSaved={(projectName) => {
            setOpen(false);
            show(projectName ? `메모 저장됨 · ${projectName}` : '메모 저장됨', { variant: 'success' });
          }}
        />
      </Sheet>
    </>
  );
}

export function BottomNav({
  projects = [],
  existingTags = [],
}: {
  projects?: Project[];
  existingTags?: { tag: string; count: number }[];
}) {
  const pathname = usePathname();
  const [before, after] = [MOBILE_NAV_ITEMS.slice(0, 2), MOBILE_NAV_ITEMS.slice(2)];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {before.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
              active ? 'border-t-2 border-accent text-accent' : 'border-t-2 border-transparent text-foreground/60'
            }`}
          >
            <Icon size={22} />
            {label}
          </Link>
        );
      })}
      <div className="flex flex-1 flex-col items-center">
        <CaptureButton projects={projects} existingTags={existingTags} />
      </div>
      {after.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
              active ? 'border-t-2 border-accent text-accent' : 'border-t-2 border-transparent text-foreground/60'
            }`}
          >
            <Icon size={22} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
