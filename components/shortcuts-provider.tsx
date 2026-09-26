'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CommandPalette } from '@/components/palette/command-palette';
import { ShortcutSheet } from '@/components/palette/shortcut-sheet';
import type { PaletteEntry } from '@/lib/logic/palette';

const NAV_KEYS: Record<string, string> = { h: '/', m: '/memo', p: '/projects', l: '/papers', c: '/calendar' };
const G_SEQUENCE_WINDOW_MS = 800;
/** visibilitychange refresh only fires if the tab was hidden this long (§4.6). */
const STALE_AFTER_MS = 5 * 60 * 1000;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Mounted once from app/(main)/layout.tsx. Owns: ⌘K palette + `?` shortcut sheet,
 * global keyboard shortcuts (§4.2), and the visibilitychange refresh (§4.6) — no
 * pull-to-refresh, so a PWA tab left open re-syncs when it's brought back after a
 * while instead.
 */
export function ShortcutsProvider({
  indexEntries,
  children,
}: {
  indexEntries: PaletteEntry[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const gPendingRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set from an effect (not at render time — Date.now() is impure) on first mount.
  const lastVisibleAtRef = useRef<number | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (isTypingTarget(e.target) || paletteOpen || sheetOpen) return;

      if (gPendingRef.current) {
        gPendingRef.current = false;
        if (gTimerRef.current) clearTimeout(gTimerRef.current);
        const href = NAV_KEYS[e.key.toLowerCase()];
        if (href) {
          e.preventDefault();
          router.push(href);
        }
        return;
      }
      if (e.key === 'g') {
        gPendingRef.current = true;
        gTimerRef.current = setTimeout(() => {
          gPendingRef.current = false;
        }, G_SEQUENCE_WINDOW_MS);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setSheetOpen(true);
        return;
      }
      if (e.key === 'c') {
        e.preventDefault();
        window.dispatchEvent(new Event('cc:focus-capture'));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (gTimerRef.current) clearTimeout(gTimerRef.current);
    };
  }, [paletteOpen, sheetOpen, router]);

  useEffect(() => {
    lastVisibleAtRef.current = Date.now();
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      const last = lastVisibleAtRef.current;
      if (last !== null && Date.now() - last > STALE_AFTER_MS) router.refresh();
      lastVisibleAtRef.current = Date.now();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [router]);

  // The sidebar's "검색·명령" button (components/nav.tsx) opens the palette via this event.
  useEffect(() => {
    function onOpenPalette() {
      setPaletteOpen(true);
    }
    window.addEventListener('cc:open-palette', onOpenPalette);
    return () => window.removeEventListener('cc:open-palette', onOpenPalette);
  }, []);

  return (
    <>
      {children}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} indexEntries={indexEntries} />
      <ShortcutSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
