'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'cc-theme';

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
}

/** Manual light/dark toggle. Initial theme is set by an inline script in layout.tsx to avoid flash. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time DOM read set by the inline theme script
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        const next = !dark;
        setDark(next);
        applyTheme(next);
      }}
      aria-label="다크 모드 전환"
      className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground/70 transition hover:bg-foreground/5"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

/** Inline script string: reads stored/system preference before paint. */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`;
