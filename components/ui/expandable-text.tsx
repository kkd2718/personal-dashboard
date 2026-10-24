'use client';

import { useState } from 'react';

/** Row text that is cut to one line (full text on hover via `title`) and wraps on click/tap/Enter, for touch
 * screens where there is no hover. A button, so it is keyboard accessible; keep it outside any link or label. */
export function ExpandableText({
  text,
  className = '',
  children,
}: {
  text: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={open}
      title={text}
      onClick={() => setOpen((o) => !o)}
      className={`min-w-0 flex-1 cursor-pointer text-left ${open ? 'whitespace-normal break-words' : 'truncate'} ${className}`}
    >
      {children ?? text}
    </button>
  );
}
