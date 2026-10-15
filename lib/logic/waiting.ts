// Reply-waiting tracker (docs/PLAN_AX.md §7): items the owner is waiting on, matched
// against Gmail by the per-account Apps Script. Pure.
import type { JevQuestion } from '@/lib/ai/jev';
import type { Proposal } from '@/lib/logic/ax-proposal';
import { addDaysStr, dday } from '@/lib/logic/dates';

export const WAITING_META_KEY = 'waiting:replies';

export type ReplyCategory = 'approved' | 'declined' | 'question' | 'other';

export interface WaitingReply {
  messageId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string; // ISO
  category?: ReplyCategory;
  positive?: number;
}

export interface WaitingItem {
  id: string; // 'w' + 6 [0-9a-z]
  title: string;
  projectId: string | null;
  taskId: string | null;
  deadlineId: string | null;
  match: { from?: string; subject?: string };
  since: string; // 'YYYY-MM-DD' KST
  createdAt: string; // ISO; replies must be at/after this instant
  nudgeAfterDays: number; // default 7
  status: 'open' | 'replied' | 'closed';
  reply?: WaitingReply;
}

export interface WaitingMatchInput {
  id: string;
  matches: Array<{ messageId: string; from: string; subject: string; snippet: string; receivedAt: string }>;
}

export function newWaitingId(rand: () => number = Math.random): string {
  let id = 'w';
  for (let i = 0; i < 6; i++) id += Math.floor(rand() * 36).toString(36);
  return id;
}

export function newWaitingItem(
  p: Extract<Proposal, { kind: 'waiting_reply' }>,
  today: string,
  now: string,
  id: string
): WaitingItem {
  return {
    id,
    title: p.title,
    projectId: p.projectId,
    taskId: p.taskId ?? null,
    deadlineId: p.deadlineId ?? null,
    match: p.match,
    since: today,
    createdAt: now,
    nudgeAfterDays: p.nudgeAfterDays,
    status: 'open',
  };
}

/** Gmail search for replies: sender and/or subject, from the day before `since`, never our own sent mail. */
export function waitingGmailQuery(item: WaitingItem): string | null {
  const parts: string[] = [];
  if (item.match.from) parts.push(`from:${item.match.from}`);
  const subject = item.match.subject?.replace(/["()]/g, '').replace(/\s+/g, ' ').trim();
  if (subject) parts.push(`subject:"${subject}"`);
  if (parts.length === 0) return null;
  parts.push(`after:${addDaysStr(item.since, -1).replace(/-/g, '/')}`);
  return `${parts.join(' ')} -in:sent -in:chats in:anywhere`;
}

/** What the Apps Script should search: `after` is the creation instant (replies must be newer). */
export function waitingQueries(items: WaitingItem[]): Array<{ id: string; query: string; after: string }> {
  const out: Array<{ id: string; query: string; after: string }> = [];
  for (const item of items) {
    if (item.status !== 'open') continue;
    const query = waitingGmailQuery(item);
    if (query) out.push({ id: item.id, query, after: item.createdAt });
    if (out.length >= 30) break;
  }
  return out;
}

/** Marks open items as replied by the earliest matching message that arrived after they were created. */
export function applyWaitingMatches(
  items: WaitingItem[],
  input: WaitingMatchInput[]
): { items: WaitingItem[]; replied: Array<{ item: WaitingItem; reply: WaitingReply }> } {
  const byId = new Map(input.map((i) => [i.id, i]));
  const replied: Array<{ item: WaitingItem; reply: WaitingReply }> = [];
  const next = items.map((item) => {
    const found = byId.get(item.id);
    if (!found || item.status !== 'open') return item;
    const created = Date.parse(item.createdAt);
    const earliest = found.matches
      .filter((m) => Date.parse(m.receivedAt) >= created)
      .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))[0];
    if (!earliest) return item;
    const reply: WaitingReply = {
      messageId: earliest.messageId,
      from: earliest.from,
      subject: earliest.subject,
      snippet: earliest.snippet,
      date: earliest.receivedAt,
    };
    const updated: WaitingItem = { ...item, status: 'replied', reply };
    replied.push({ item: updated, reply });
    return updated;
  });
  return { items: next, replied };
}

export function waitingNudges(items: WaitingItem[], today: string): Array<{ item: WaitingItem; days: number }> {
  return items
    .filter((i) => i.status === 'open')
    .map((item) => ({ item, days: dday(today, item.since) }))
    .filter((n) => n.days >= n.item.nudgeAfterDays);
}

export function openWaitingList(items: WaitingItem[]): WaitingItem[] {
  return items
    .filter((i) => i.status === 'open')
    .sort((a, b) => a.since.localeCompare(b.since) || a.createdAt.localeCompare(b.createdAt));
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const DOMAIN_RE = /(?<![\w@.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?![\w@-])/i;

/** First email address, else first bare domain, in `text` (URLs are ignored). */
export function extractEmailOrDomain(text: string): string | null {
  const cleaned = text.replace(/https?:\/\/\S+/gi, ' ');
  const email = EMAIL_RE.exec(cleaned);
  if (email) return email[0].toLowerCase();
  const domain = DOMAIN_RE.exec(cleaned);
  return domain ? domain[0].toLowerCase() : null;
}

/** `null` clears the field (`from:-` / `subject:-`). */
export interface WaitPatch {
  from?: string | null;
  subject?: string | null;
  nudgeAfterDays?: number;
}

export type WaitCommand =
  | { kind: 'list' }
  | { kind: 'edit'; target: string; patch: WaitPatch }
  | { kind: 'close'; target: string }
  | { kind: 'reopen'; target: string }
  | { kind: 'invalid' };

/** `/wait` argument: '' | '<n|id> from:x subject:"y" days:5' | '<n|id> close'. */
export function parseWaitCommand(arg: string): WaitCommand {
  const text = arg.trim();
  if (!text) return { kind: 'list' };
  const m = /^(\S+)\s+([\s\S]+)$/.exec(text);
  if (!m || !/^(?:\d+|w[0-9a-z]{5,7})$/.test(m[1])) return { kind: 'invalid' };
  const [, target, rest] = m;
  if (rest.trim() === 'close') return { kind: 'close', target };
  if (rest.trim() === 'reopen') return { kind: 'reopen', target };

  const patch: WaitPatch = {};
  const from = /(?:^|\s)from:(\S+)/.exec(rest);
  if (from) patch.from = from[1] === '-' ? null : from[1];
  const subject = /(?:^|\s)subject:(?:"([^"]+)"|(\S+))/.exec(rest);
  if (subject) patch.subject = subject[1] ?? (subject[2] === '-' ? null : subject[2]);
  const days = /(?:^|\s)days:(\d{1,3})(?!\d)/.exec(rest);
  if (days) patch.nudgeAfterDays = Number(days[1]);
  return Object.keys(patch).length > 0 ? { kind: 'edit', target, patch } : { kind: 'invalid' };
}

/** Lower-cased addresses from OWNER_EMAILS (comma/space separated): mail from these is never a reply. */
export function parseOwnerEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwnerSender(from: string, owners: string[]): boolean {
  const f = from.toLowerCase();
  return owners.some((o) => f.includes(o));
}

/** "3일 기다림" / "대기 3일": the number of days to wait, not a date. Returns the text with that span blanked. */
export function extractWaitDays(text: string): { days: number | null; text: string } {
  const re = /(\d{1,3})\s?일\s?(?:째|간|동안|정도)?\s?(?=기다|대기)|(?<=(?:기다림?|기다려|대기)\s{0,2})(\d{1,3})\s?일/;
  const m = re.exec(text);
  if (!m) return { days: null, text };
  return { days: Number(m[1] ?? m[2]), text: text.slice(0, m.index) + ' '.repeat(m[0].length) + text.slice(m.index + m[0].length) };
}

/** 1-based index into the open list, or an item id. */
export function resolveWaitTarget(items: WaitingItem[], target: string): WaitingItem | null {
  if (/^\d+$/.test(target)) return openWaitingList(items)[Number(target) - 1] ?? null;
  return items.find((i) => i.id === target) ?? null;
}

export const REPLY_CATEGORIES: ReplyCategory[] = ['approved', 'declined', 'question', 'other'];

/** One Jev request to classify an incoming reply. */
export function replyQuestions(): Record<string, JevQuestion> {
  return {
    positive: { type: 'noul', instructions: '이 답장은 요청을 승인·수락하는 긍정적인 내용인가?' },
    category: {
      type: 'choice',
      instructions: '이 답장의 성격을 하나 고르세요.',
      criteria: {
        approved: '승인, 수락, 채택, 문제 없음',
        declined: '거절, 반려, 불가',
        question: '추가 질문이나 자료 요청',
        other: '그 외 (자동 응답, 단순 수신 확인 등)',
      },
    },
  };
}

export function replyState(title: string, reply: Pick<WaitingReply, 'from' | 'snippet'>): string {
  return `제목: ${title}\n보낸이: ${reply.from}\n내용: ${reply.snippet}`;
}
