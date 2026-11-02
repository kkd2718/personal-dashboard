'use client';

import { useEffect, useRef, useState } from 'react';
import { unstable_isUnrecognizedActionError } from 'next/navigation';
import {
  ACTION_MISMATCH,
  RELOAD_MARK_KEY,
  VERSION_CHECK_THROTTLE_MS,
  parseVersionResponse,
  skewAction,
} from '@/lib/logic/version-skew';

const CLIENT_VERSION = process.env.CC_APP_VERSION ?? 'dev';

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'email', 'tel', 'number']);

function isTrackedField(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  return el.isContentEditable;
}

function fieldText(el: HTMLElement): string {
  return 'value' in el ? String((el as HTMLInputElement).value) : (el.textContent ?? '');
}

/** Reloads a tab that outlived a deploy (idle PWA resumed, stale server-action bundle) —
 * never while a text field holds unsaved input; then it shows a banner instead. */
export function VersionWatcher() {
  const [stale, setStale] = useState(false);
  const serverRef = useRef<string | null>(null);

  useEffect(() => {
    if (CLIENT_VERSION === 'dev') return;

    const dirty = new Set<HTMLElement>();
    let lastCheck = 0;

    const onInput = (e: Event) => {
      if (isTrackedField(e.target)) dirty.add(e.target);
    };
    const hasUnsavedInput = () => {
      for (const el of [...dirty]) {
        if (!el.isConnected) dirty.delete(el);
        else if (fieldText(el).trim() !== '') return true;
      }
      return false;
    };

    const check = async (serverOverride?: string) => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (!serverOverride && now - lastCheck < VERSION_CHECK_THROTTLE_MS) return;
      lastCheck = now;

      let fetched: string | null = null;
      try {
        const res = await fetch('/api/version', { cache: 'no-store', redirect: 'manual' });
        if (res.ok) fetched = parseVersionResponse(await res.json());
      } catch {
        // offline / redirected to /login — treated as unknown
      }
      const server = fetched ?? serverOverride ?? null;
      if (server === CLIENT_VERSION) sessionStorage.removeItem(RELOAD_MARK_KEY);
      const action = skewAction({
        clientVersion: CLIENT_VERSION,
        serverVersion: server,
        unsafe: hasUnsavedInput(),
        reloadedFor: sessionStorage.getItem(RELOAD_MARK_KEY),
      });
      if (action === 'reload' && server) {
        sessionStorage.setItem(RELOAD_MARK_KEY, server);
        location.reload();
      } else if (action === 'prompt') {
        if (server) serverRef.current = server;
        setStale(true);
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const onFocus = () => void check();
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void check();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (unstable_isUnrecognizedActionError(e.reason)) void check(ACTION_MISMATCH);
    };
    const onError = (e: ErrorEvent) => {
      if (unstable_isUnrecognizedActionError(e.error)) void check(ACTION_MISMATCH);
    };

    document.addEventListener('input', onInput, true);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);

  if (!stale) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-4">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800">
        <span>새 버전이 배포됐어요</span>
        <button
          type="button"
          className="rounded-md bg-slate-900 px-2.5 py-1 text-white dark:bg-slate-100 dark:text-slate-900"
          onClick={() => {
            if (serverRef.current) sessionStorage.setItem(RELOAD_MARK_KEY, serverRef.current);
            location.reload();
          }}
        >
          새로고침
        </button>
      </div>
    </div>
  );
}
