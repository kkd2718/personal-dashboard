// Telegram free-text flow with Jev classification (docs/PLAN_AX.md §6): a message that
// looks like a status update becomes a confirmable proposal; everything else (and every
// failure) falls back to a plain memo. Nothing changes until the user taps 적용.
import { JEV_DAILY_LIMIT_AX, takeJevBudget } from '@/lib/ai/jev-budget';
import type { Jev } from '@/lib/ai/jev';
import { applyProposal } from '@/lib/ax/apply';
import { claimPending, loadPending, loadPendingRaw, savePending, updatePending, type PendingRepo } from '@/lib/ax/pending';
import { formatWeekly, weeklyKeyboard, WEEKLY_TTL_HOURS, type PendingWeekly } from '@/lib/logic/weekly-review';
import { applyWeeklyAction, type WeeklyRepo } from '@/lib/telegram/weekly';
import type { ApplyRepo } from '@/lib/ax/apply';
import type { GoogleCalendarConfig } from '@/lib/google/calendar';
import { prefilterCandidates } from '@/lib/logic/ax-candidates';
import { axQuestions, axState, decide, obviousMemo } from '@/lib/logic/ax-intent';
import {
  buildProposal,
  decodeCallback,
  formatProposal,
  isExpired,
  newShortId,
  proposalKeyboard,
  type PendingProposal,
  type PendingStatus,
} from '@/lib/logic/ax-proposal';
import { kstDateTime } from '@/lib/logic/dates';
import type { Repo } from '@/lib/repo';
import type { InlineKeyboard } from '@/lib/telegram/client';
import { escapeHtml, formatCaptureReply } from '@/lib/telegram/format';
import type { Note } from '@/lib/types';

export type AxRepo = PendingRepo & ApplyRepo & WeeklyRepo & Pick<Repo, 'listProjects' | 'listPapers'>;

export interface AxDeps {
  repo: AxRepo;
  jev: Jev | null;
  send(text: string): Promise<unknown>;
  sendWithMarkup(text: string, markup: InlineKeyboard): Promise<{ ok: boolean }>;
  edit(messageId: number, text: string, markup?: InlineKeyboard | null): Promise<unknown>;
  answer(callbackId: string, text?: string): Promise<unknown>;
  createNote(text: string): Promise<Note>;
  calendarCfg: GoogleCalendarConfig | null;
  now(): Date;
  /** Called after a proposal was applied (route layer revalidates pages). */
  onApplied?(): void;
  fetchImpl?: typeof fetch;
}

const PROPOSAL_TTL_HOURS = 24;

const note = (text: string) => `\n<i>(${text})</i>`;
const SUFFIX_UNSURE = note('업데이트로 확신하지 못해 메모로 저장했어요');
const SUFFIX_BUDGET = note('오늘 분류 한도 도달 — 메모로 저장했어요');

/** Saves `text` as a memo and sends today's reply (byte-identical when `suffix` is empty). */
async function saveMemo(deps: AxDeps, text: string, suffix = ''): Promise<void> {
  const created = await deps.createNote(text);
  const projectName = created.projectId
    ? ((await deps.repo.listProjects()).find((p) => p.id === created.projectId)?.name ?? null)
    : null;
  await deps.send(formatCaptureReply(created, projectName) + suffix);
}

type Outcome = { memoSuffix: string } | { proposal: PendingProposal; today: string };

/** Everything that can fail without losing the message: classification, proposal, storage. */
async function classify(deps: AxDeps, jev: Jev, text: string): Promise<Outcome> {
  let suffix = SUFFIX_UNSURE;
  try {
    const nowDate = deps.now();
    const { date: today, time: nowTime } = kstDateTime(nowDate.toISOString());
    const [tasks, deadlines, projects, papers] = await Promise.all([
      deps.repo.listTasks(),
      deps.repo.listDeadlines(),
      deps.repo.listProjects(),
      deps.repo.listPapers(),
    ]);
    const candidates = prefilterCandidates(text, tasks, deadlines, projects);

    if (!(await takeJevBudget(deps.repo, 'ax', today, JEV_DAILY_LIMIT_AX))) {
      suffix = SUFFIX_BUDGET;
      throw new Error('budget');
    }
    const decision = decide(await jev.ask(axState(text, today), axQuestions(candidates)), candidates);
    if (!decision.ok) throw new Error(decision.reason);
    if (decision.intent === 'memo') return { memoSuffix: '' };
    if (decision.intent === 'calendar_event' && !deps.calendarCfg) {
      return { memoSuffix: note('캘린더 연동 미설정 — 메모로 저장했어요') };
    }

    const built = buildProposal({
      text,
      today,
      nowTime,
      intent: decision.intent,
      target: decision.target,
      tasks,
      deadlines,
      projects,
      papers,
    });
    if (!built.ok) return { memoSuffix: note(`${escapeHtml(built.reason)} — 메모로 저장했어요`) };

    const proposal: PendingProposal = {
      type: 'proposal',
      id: newShortId(),
      createdAt: nowDate.toISOString(),
      text,
      proposal: built.proposal,
      status: 'pending',
    };
    await savePending(deps.repo, proposal, proposal.createdAt);
    return { proposal, today };
  } catch {
    return { memoSuffix: suffix };
  }
}

export async function handleFreeText(deps: AxDeps, text: string): Promise<void> {
  if (!deps.jev || obviousMemo(text)) return saveMemo(deps, text);
  const outcome = await classify(deps, deps.jev, text);
  if ('proposal' in outcome) {
    const sent = await deps.sendWithMarkup(
      formatProposal(outcome.proposal.proposal, outcome.today),
      proposalKeyboard(outcome.proposal.id)
    );
    if (sent.ok) return;
    // The buttons never reached the user: don't strand the text in a pending record.
    return saveMemo(deps, text, note('확인 메시지를 보내지 못해 메모로 저장했어요'));
  }
  return saveMemo(deps, text, outcome.memoSuffix);
}

export interface CallbackInput {
  callbackId: string;
  messageId: number;
  data: string;
}

export async function handleCallback(deps: AxDeps, cb: CallbackInput): Promise<void> {
  const decoded = decodeCallback(cb.data);
  if (!decoded) return void (await deps.answer(cb.callbackId, '알 수 없는 버튼'));
  if (decoded.t === 'w') return handleWeeklyCallback(deps, cb, decoded);

  const record = await loadPending(deps.repo, decoded.id);
  if (!record) return void (await deps.answer(cb.callbackId, '만료됨'));
  if (record.status !== 'pending') return void (await deps.answer(cb.callbackId, '이미 처리됨'));

  const nowDate = deps.now();
  const today = kstDateTime(nowDate.toISOString()).date;
  const body = formatProposal(record.proposal, today);
  if (isExpired(record.createdAt, nowDate.toISOString(), PROPOSAL_TTL_HOURS)) {
    await deps.answer(cb.callbackId, '만료됨');
    await deps.edit(cb.messageId, `${body}\n<i>만료됨</i>`, null);
    return;
  }

  // Atomic claim first: two concurrent taps both pass the status check above.
  if (!(await claimPending(deps.repo, record.id, nowDate.toISOString()))) {
    return void (await deps.answer(cb.callbackId, '이미 처리됨'));
  }
  // Status is written before the side effect so a retry can't apply twice either.
  const status: PendingStatus = decoded.a === 'ok' ? 'applied' : decoded.a === 'no' ? 'cancelled' : 'memo';
  await updatePending(deps.repo, { ...record, status });

  let result: string;
  try {
    if (decoded.a === 'ok') {
      result = await applyProposal(deps.repo, { today, calendarCfg: deps.calendarCfg, fetchImpl: deps.fetchImpl }, record.proposal);
      deps.onApplied?.();
    } else if (decoded.a === 'no') {
      result = '<i>취소했어요</i>';
    } else {
      await deps.createNote(record.text);
      result = '📝 메모로 저장했어요';
    }
  } catch {
    result = '⚠️ 처리하지 못했어요';
  }
  await updatePending(deps.repo, { ...record, status, result }).catch(() => {});
  await deps.edit(cb.messageId, `${body}\n${result}`, null);
  await deps.answer(cb.callbackId);
}

async function handleWeeklyCallback(
  deps: AxDeps,
  cb: CallbackInput,
  decoded: Extract<NonNullable<ReturnType<typeof decodeCallback>>, { t: 'w' }>
): Promise<void> {
  const raw = await loadPendingRaw(deps.repo, decoded.id);
  if (!raw || raw.type !== 'weekly') return void (await deps.answer(cb.callbackId, '만료됨'));
  const record = raw as PendingWeekly;

  const nowDate = deps.now();
  if (isExpired(record.createdAt, nowDate.toISOString(), WEEKLY_TTL_HOURS)) {
    await deps.answer(cb.callbackId, '만료됨');
    await deps.edit(cb.messageId, `${formatWeekly(record.review, record.today)}
<i>만료됨</i>`, null);
    return;
  }
  // Per-item atomic claim: a double tap on the same button must not apply twice.
  if (!(await claimPending(deps.repo, `${record.id}:${decoded.i}`, nowDate.toISOString()))) {
    return void (await deps.answer(cb.callbackId, '이미 처리됨'));
  }

  const today = kstDateTime(nowDate.toISOString()).date;
  let next = record;
  let result: string;
  try {
    ({ record: next, result } = await applyWeeklyAction(deps.repo, record, decoded.i, decoded.a, today));
  } catch {
    result = '⚠️ 처리하지 못했어요';
  }
  if (next === record) {
    // Nothing changed (already handled / target gone): don't write a stale snapshot back.
    return void (await deps.answer(cb.callbackId, result));
  }
  // Re-read before saving: other items may have been handled since this tap was read.
  const latest = (await loadPendingRaw(deps.repo, record.id)) as PendingWeekly | null;
  if (latest?.type === 'weekly') {
    const items = latest.review.items.map((it, i) => (i === decoded.i ? next.review.items[i] : it));
    next = { ...latest, review: { ...latest.review, items } };
  }
  await updatePending(deps.repo, next).catch(() => {});
  deps.onApplied?.();
  await deps.edit(cb.messageId, formatWeekly(next.review, next.today), weeklyKeyboard(next.id, next.review.items));
  await deps.answer(cb.callbackId, result);
}
