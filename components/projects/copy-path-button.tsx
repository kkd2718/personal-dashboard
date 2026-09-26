'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import { useToast } from '@/components/ui/toast';

/** Copies `path` to the clipboard — the only place it's ever exposed (tooltip only,
 * never printed on the page, ux-advice.md §5.4). */
export function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const { show } = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      show('복사하지 못했어요. 다시 시도해 주세요.', { variant: 'danger' });
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={path}
      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground/70 hover:bg-foreground/5"
    >
      <Copy size={12} />
      {copied ? '복사됨' : '경로 복사'}
    </button>
  );
}
