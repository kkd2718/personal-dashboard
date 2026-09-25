import type { NoteKind } from '@/lib/types';

export interface ShareInput {
  title?: string;
  text?: string;
  url?: string;
}

export interface ParsedShare {
  body: string;
  kind: NoteKind;
}

/**
 * Turn a Web Share Target payload into a note body + kind.
 * url present -> kind 'link'; lines are title/text/url, deduped and trimmed.
 * Throws if everything is empty.
 */
export function parseShare({ title, text, url }: ShareInput): ParsedShare {
  const t = (title ?? '').trim();
  const x = (text ?? '').trim();
  const u = (url ?? '').trim();

  const lines: string[] = [];
  if (t) lines.push(t);
  if (x) lines.push(x);
  if (u && !x.includes(u)) lines.push(u);

  const body = lines.join('\n').trim();
  if (!body) throw new Error('parseShare: title, text and url are all empty');

  return { body, kind: u ? 'link' : 'memo' };
}
