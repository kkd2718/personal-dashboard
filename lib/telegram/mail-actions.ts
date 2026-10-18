// Mail alert extras: a Haiku summary under the alert plus two buttons (작업 준비 요청 -> sent memo to
// the matched project; 답장 초안 -> a drafted reply shown in Telegram). Nothing is written to Gmail
// and nothing happens automatically beyond the summary. Any AI failure -> today's plain alert.
import { escapeHtml } from '@/lib/telegram/format';
import { claimPending, loadPendingRaw, savePending, updatePending } from '@/lib/ax/pending';
import { oneShot } from '@/lib/ask/oneshot';
import type { AskClient } from '@/lib/ask/client';
import { isExpired, newShortId, type CallbackData } from '@/lib/logic/ax-proposal';
import { kstDateTime } from '@/lib/logic/dates';
import {
  DRAFT_SYSTEM,
  MAIL_PENDING_TTL_HOURS,
  MAX_PICK,
  SUMMARY_SYSTEM,
  cleanSummary,
  findProjectInText,
  mailKeyboard,
  mailMemoBody,
  mailPrompt,
  pickKeyboard,
  type MailPending,
} from '@/lib/logic/mail-ai';
import type { AxDeps } from '@/lib/telegram/ax';
import type { InlineKeyboard, SendResult } from '@/lib/telegram/client';
import type { Project } from '@/lib/types';

export interface MailAlertDeps {
  repo: AxDeps['repo'];
  client: AskClient | null;
  today: string;
  nowIso: string;
  send(text: string, markup?: InlineKeyboard): Promise<SendResult>;
  env?: Record<string, string | undefined>;
}

export interface MailAlertItem {
  /** HTML header already built by the caller (sender/subject/link or candidate line). */
  header: string;
  from: string;
  subject: string;
  snippet: string;
  link: string | null;
  /** Known project (e.g. from the paper of a review candidate); else matched by keyword. */
  projectId?: string | null;
}

/** 1-2 line Korean summary, or null (no client, budget out, failure, empty). */
export async function summarizeMail(
  deps: MailAlertDeps,
  item: Pick<MailAlertItem, 'from' | 'subject' | 'snippet'>,
  timeoutMs = 8000
): Promise<string | null> {
  const r = await oneShot(deps, 'mail', { system: SUMMARY_SYSTEM, user: mailPrompt(item), maxTokens: 200, timeoutMs });
  return cleanSummary(r?.text);
}

/** Total time for all summaries of one request; after it the remaining alerts go out without one. */
export const SUMMARY_BUDGET_MS = 12_000;
const MIN_CALL_MS = 1500;

/** Summaries one at a time (each read-modify-writes the spend ledger) inside a shared time budget measured from
 * `startedAt`; once under MIN_CALL_MS is left, the rest are null. */
export async function summarizeAll(
  deps: MailAlertDeps,
  items: Array<Pick<MailAlertItem, 'from' | 'subject' | 'snippet'>>,
  startedAt: number,
  opts: { budgetMs?: number; now?: () => number } = {}
): Promise<Array<string | null>> {
  const now = opts.now ?? Date.now;
  const budget = opts.budgetMs ?? SUMMARY_BUDGET_MS;
  const out: Array<string | null> = [];
  for (const item of items) {
    const left = budget - (now() - startedAt);
    out.push(left < MIN_CALL_MS ? null : await summarizeMail(deps, item, Math.min(8000, left)));
  }
  return out;
}

/** Sends one alert: header, optional summary line, and the two buttons (pending record kept 48 h). */
export async function sendMailAlert(deps: MailAlertDeps, item: MailAlertItem, summary: string | null, projects: Project[]): Promise<SendResult> {
  const text = summary ? `${item.header}\n🧾 ${escapeHtml(summary)}` : item.header;
  const projectId = item.projectId ?? findProjectInText(projects, `${item.subject} ${item.snippet}`)?.id ?? null;
  const record: MailPending = {
    type: 'mail',
    id: newShortId(),
    createdAt: deps.nowIso,
    from: item.from,
    subject: item.subject,
    snippet: item.snippet,
    link: item.link,
    summary,
    projectId,
  };
  try {
    await savePending(deps.repo, record, deps.nowIso);
  } catch {
    return deps.send(text); // no buttons without a stored record
  }
  return deps.send(text, mailKeyboard(record.id));
}

/** Callback for `m:<id>:p|r|s<n>`. */
export async function handleMailCallback(
  deps: AxDeps,
  cb: { callbackId: string },
  decoded: Extract<CallbackData, { t: 'm' }>
): Promise<void> {
  const raw = await loadPendingRaw(deps.repo, decoded.id);
  const nowIso = deps.now().toISOString();
  if (!raw || raw.type !== 'mail' || isExpired(raw.createdAt, nowIso, MAIL_PENDING_TTL_HOURS)) {
    return void (await deps.answer(cb.callbackId, decoded.a === 'r' ? '48시간이 지나 초안을 만들 수 없어요' : '48시간이 지나 만료됐어요'));
  }
  const record = raw as unknown as MailPending;
  if (decoded.a === 'r') return replyDraft(deps, cb.callbackId, record, nowIso);
  return prepareWork(deps, cb.callbackId, record, nowIso, decoded.a === 's' ? decoded.i : null);
}

async function prepareWork(deps: AxDeps, callbackId: string, record: MailPending, nowIso: string, pick: number | null): Promise<void> {
  const projects = await deps.repo.listProjects();
  const projectId = pick !== null ? (record.choices?.[pick] ?? null) : record.projectId;
  const project = projects.find((p) => p.id === projectId);

  if (!project) {
    // No match: ask which project (buttons carry an index into the stored choices).
    const choices = projects.filter((p) => p.status === 'active').slice(0, MAX_PICK);
    if (choices.length === 0) return void (await deps.answer(callbackId, '프로젝트가 없어요'));
    await updatePending(deps.repo, { ...record, choices: choices.map((p) => p.id) });
    await deps.answer(callbackId, '프로젝트를 골라 주세요');
    await deps.sendWithMarkup(`📂 어느 프로젝트에 보낼까요?\n<i>${escapeHtml(record.subject.slice(0, 80))}</i>`, pickKeyboard(record.id, choices));
    return;
  }

  if (!(await claimPending(deps.repo, `${record.id}:p`, nowIso))) return void (await deps.answer(callbackId, '이미 처리됨'));
  try {
    const created = await deps.repo.createNote({ body: mailMemoBody(record), kind: 'memo', projectId: project.id, source: 'telegram' });
    await deps.repo.updateNote(created.id, { status: 'sent' });
    deps.onApplied?.();
    await deps.answer(callbackId, '보냈어요');
    await deps.send(`📨 ${escapeHtml(project.name)} 세션으로 보냈어요`);
  } catch {
    await deps.repo.deleteMeta(`ax:applied:${record.id}:p`).catch(() => {}); // let the owner retry
    await deps.answer(callbackId, '⚠️ 처리하지 못했어요');
  }
}

async function replyDraft(deps: AxDeps, callbackId: string, record: MailPending, nowIso: string): Promise<void> {
  if (!(await claimPending(deps.repo, `${record.id}:r`, nowIso))) return void (await deps.answer(callbackId, '이미 처리됨'));
  const today = kstDateTime(nowIso).date;
  const draft = await oneShot({ client: deps.askClient ?? null, repo: deps.repo, today }, 'mail', {
    system: DRAFT_SYSTEM,
    user: mailPrompt(record, record.summary),
    maxTokens: 1000,
    timeoutMs: 20000,
    preferSonnet: true,
  });
  if (!draft) {
    await deps.repo.deleteMeta(`ax:applied:${record.id}:r`).catch(() => {});
    return void (await deps.answer(callbackId, '지금은 초안을 만들 수 없어요'));
  }
  await deps.answer(callbackId);
  const cost = draft.usd === null ? '' : ` · $${draft.usd.toFixed(3)}`;
  await deps.send(`✍️ <b>답장 초안</b> — ${escapeHtml(record.subject.slice(0, 60))}\n<pre>${escapeHtml(draft.text)}</pre>\n<i>${draft.model.replace(/^claude-/, '').replace(/-\d+-\d+$/, '')}${cost} · Gmail에는 아무것도 쓰지 않았어요</i>`);
}
