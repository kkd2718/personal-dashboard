// Mail triage helpers (docs/PLAN_AX.md §8b): which inbox mail deserves a Telegram alert.
// Pure. Nothing here persists mail content; only message ids and counters are stored.
import type { JevQuestion } from '@/lib/ai/jev';

export const MAIL_TRIAGE_CONFIG_KEY = 'mail:triage:config';
export const TRIAGE_THRESHOLD = 0.7;
export const MAIL_SEEN_CAP = 1000;
export const MAX_ALERTS_PER_MESSAGE = 5;

export interface TriageConfig {
  allow: string[]; // always alert (no Jev)
  deny: string[]; // never alert; wins over allow
  noBodyAccounts: string[]; // server-side kill switch: drop snippets from these accounts
  threshold?: number;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((s) => s.trim().toLowerCase()) : [];

export function normalizeTriageConfig(raw: unknown): TriageConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    allow: strings(o.allow),
    deny: strings(o.deny),
    noBodyAccounts: Array.isArray(o.noBodyAccounts) ? o.noBodyAccounts.filter((x): x is string => typeof x === 'string') : [],
    ...(typeof o.threshold === 'number' ? { threshold: o.threshold } : {}),
  };
}

/** Same pattern as Code.gs stripAttachmentNames_: file names never reach Telegram or Jev. */
const ATTACHMENT_NAME_RE = /\S+\.(pdf|hwpx?|docx?|xlsx?|pptx?|csv|zip|7z|dcm|jpe?g|png|tiff?)\b/gi;

export function stripAttachmentNames(text: string): string {
  return text.replace(ATTACHMENT_NAME_RE, '').replace(/\s+/g, ' ').trim();
}

export const mailSeenKey = (account: string) => `mail:triage:seen:${account}`;
export const mailAlertedKey = (date: string) => `mail:triage:alerted:${date}`;
export const MAIL_CAP_NOTICE_KEY = 'mail:triage:capNotice';

export interface TriageMail {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  receivedAt: string;
  link: string;
  snippet?: string;
}

/** 'Name <A@B.com>' -> 'a@b.com'; a bare address is just lower-cased. */
export function senderAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}

/** `a@b.com` matches exactly; `@b.com` / `b.com` match that domain and its sub-domains. */
export function matchesSender(address: string, patterns: string[]): boolean {
  const addr = address.toLowerCase();
  const domain = addr.slice(addr.lastIndexOf('@') + 1);
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (p.includes('@') && !p.startsWith('@')) return addr === p;
    const d = p.replace(/^@/, '');
    return domain === d || domain.endsWith(`.${d}`);
  });
}

export type TriageDecision = 'deny' | 'allow' | 'ask';

export function triageDecision(m: TriageMail, cfg: TriageConfig): TriageDecision {
  const addr = senderAddress(m.from);
  if (matchesSender(addr, cfg.deny)) return 'deny';
  if (matchesSender(addr, cfg.allow)) return 'allow';
  return 'ask';
}

export function unseen(mails: TriageMail[], seen: string[]): TriageMail[] {
  const known = new Set(seen);
  const out: TriageMail[] = [];
  for (const m of mails) {
    if (known.has(m.messageId)) continue;
    known.add(m.messageId); // also drops duplicates inside one batch
    out.push(m);
  }
  return out;
}

/** Appends ids to the seen ring, keeping only the newest `cap`. */
export function rememberSeen(seen: string[], ids: string[], cap = MAIL_SEEN_CAP): string[] {
  return [...seen, ...ids].slice(-cap);
}

/** Sender + subject without Re:/Fwd: prefixes: the same letter in both accounts alerts once per day. */
export function crossAccountKey(m: TriageMail): string {
  const subject = m.subject
    .replace(/^(?:\s*(?:re|fwd?|회신|답장|전달)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return `${senderAddress(m.from)}|${subject}`;
}

export function triageState(m: TriageMail): string {
  return `보낸이: ${m.from}\n제목: ${m.subject}${m.snippet ? `\n내용: ${m.snippet}` : ''}`;
}

export const ATTENTION_QUESTION: JevQuestion = {
  type: 'noul',
  instructions:
    "Does this email need the owner's attention right now (a reply or action today), rather than being fine to read later? Newsletters, receipts, automated notices and promotions do not.",
};

export type MailRuleCommand =
  | { kind: 'list' }
  | { kind: 'allow' | 'deny' | 'remove'; pattern: string }
  | { kind: 'invalid' };

/** `/mailrule` argument: '' | 'list' | 'allow <addr|@domain>' | 'deny <...>' | 'remove <...>'. */
export function parseMailRule(arg: string): MailRuleCommand {
  const t = arg.trim();
  if (!t || t === 'list') return { kind: 'list' };
  const m = /^(allow|deny|remove)\s+(\S+)$/i.exec(t);
  if (!m || !/^@?[a-z0-9._+-]+(?:@[a-z0-9.-]+)?$/i.test(m[2]) || m[2].length > 100) return { kind: 'invalid' };
  return { kind: m[1].toLowerCase() as 'allow' | 'deny' | 'remove', pattern: m[2].toLowerCase() };
}

/** Adds/removes a pattern; an allow removes it from deny and vice versa so a rule never fights itself. */
export function applyMailRule(cfg: TriageConfig, cmd: Exclude<MailRuleCommand, { kind: 'list' | 'invalid' }>): TriageConfig {
  const without = (list: string[]) => list.filter((p) => p !== cmd.pattern);
  if (cmd.kind === 'remove') return { ...cfg, allow: without(cfg.allow), deny: without(cfg.deny) };
  const other = cmd.kind === 'allow' ? 'deny' : 'allow';
  return { ...cfg, [other]: without(cfg[other]), [cmd.kind]: [...without(cfg[cmd.kind]), cmd.pattern] };
}

/** A Telegram failure worth retrying later: network trouble, rate limit, or a server error. A 4xx
 * (bad request, blocked bot) would fail identically forever, so it must not poison the batch. */
export function isRetryableSendFailure(r: { ok: boolean; error?: string; status?: number }): boolean {
  if (r.ok) return false;
  if (r.status !== undefined) return r.status === 429 || r.status >= 500;
  return r.error === 'network error';
}
