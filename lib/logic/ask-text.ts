// Text helpers for /ask answers: pull text out of API content, convert light markdown to
// Telegram HTML, split to Telegram's size limit. Pure.
import { escapeHtml } from '@/lib/telegram/format';

/** Joins the `text` blocks only (thinking / redacted_thinking / tool_use are ignored). */
export function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
    .trim();
}

const SLOT = '\u0000';

/** Light markdown -> Telegram HTML: fenced/inline code, **bold**, https links, bullets, headings. */
export function mdToTelegramHtml(md: string): string {
  const slots: string[] = [];
  const keep = (html: string): string => `${SLOT}${slots.push(html) - 1}${SLOT}`;

  let s = md.replace(/\r\n/g, '\n').replaceAll(SLOT, '');
  s = s.replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_, code: string) => keep(`<pre>${escapeHtml(code.replace(/\n$/, ''))}</pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_, code: string) => keep(`<code>${escapeHtml(code)}</code>`));

  s = escapeHtml(s);
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text: string, url: string) =>
    keep(`<a href="${url.replace(/"/g, '&quot;')}">${text}</a>`)
  );
  s = s.replace(/^#{1,6}[ \t]+(.+)$/gm, '<b>$1</b>');
  s = s.replace(/^([ \t]*)[-*][ \t]+/gm, '$1• ');
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');

  // Placeholders may nest (code inside a link label), so restore until none are left.
  const slotRe = new RegExp(`${SLOT}(\\d+)${SLOT}`, 'g');
  for (let i = 0; i < 3 && s.includes(SLOT); i++) s = s.replace(slotRe, (_, n: string) => slots[Number(n)]);
  return s;
}

const TAG_RE = /<(\/?)([a-z]+)([^>]*)>/gi;
/** Room kept per chunk for the closing/reopening tags added at a cut. */
const TAG_ROOM = 120;

/** Opening tags still open at the end of `html`, outermost first. */
function openTags(html: string, initial: string[]): string[] {
  const stack = [...initial];
  for (const m of html.matchAll(TAG_RE)) {
    if (m[1] === '/') {
      const at = stack.map((t) => /^<([a-z]+)/i.exec(t)?.[1].toLowerCase()).lastIndexOf(m[2].toLowerCase());
      if (at >= 0) stack.length = at;
    } else {
      stack.push(m[0]);
    }
  }
  return stack;
}

const closerOf = (tag: string): string => `</${/^<([a-z]+)/i.exec(tag)?.[1] ?? ''}>`;

/** Chooses where to cut `rest` (<= limit chars): blank line, then line, then hard; never inside a tag or entity. */
function cutIndex(rest: string, limit: number): number {
  let cut = rest.lastIndexOf('\n\n', limit);
  if (cut < limit / 2) cut = rest.lastIndexOf('\n', limit);
  if (cut < limit / 2) cut = limit;
  const head = rest.slice(0, cut);
  const lt = head.lastIndexOf('<');
  if (lt > head.lastIndexOf('>') && lt > 0) cut = lt;
  const amp = rest.slice(0, cut).lastIndexOf('&');
  if (amp > rest.slice(0, cut).lastIndexOf(';') && cut - amp < 10 && amp > 0) cut = amp;
  return cut;
}

/** Splits HTML into chunks <= `max`; a tag open at a cut (`<pre>`, `<b>`, `<a>`) is closed and reopened. */
export function splitTelegram(html: string, max = 4000): string[] {
  const limit = max - TAG_ROOM;
  const chunks: string[] = [];
  let rest = html.trim();
  let carried: string[] = [];
  while (rest.length > 0) {
    const prefix = carried.join('');
    if (prefix.length + rest.length <= max - closersLen(carried)) {
      chunks.push(prefix + rest);
      break;
    }
    const cut = cutIndex(rest, limit - prefix.length);
    const head = rest.slice(0, cut).trimEnd();
    const open = openTags(head, carried);
    const closers = [...open].reverse().map(closerOf).join('');
    if (head.trim()) chunks.push(prefix + head + closers);
    carried = open;
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  return chunks;
}

function closersLen(open: string[]): number {
  return open.reduce((n, t) => n + closerOf(t).length, 0);
}

/** Short note appended when the model stopped for a non-normal reason. */
export function stopReasonNote(stop: string | null): string | null {
  if (stop === 'max_tokens') return '(답이 길어 잘렸어요)';
  if (stop === 'refusal') return '(이 질문에는 답할 수 없어요)';
  return null;
}
