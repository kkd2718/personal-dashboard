import { describe, expect, it, vi } from 'vitest';
import { fakeClient, fakeRepo, message, text } from '@/lib/ask/fixtures';
import type { SpendRecord } from '@/lib/logic/ask-budget';
import { project } from '@/lib/logic/ax-fixtures';
import type { MailPending } from '@/lib/logic/mail-ai';
import type { AxDeps } from './ax';
import { handleMailCallback, sendMailAlert, summarizeMail, type MailAlertDeps } from './mail-actions';

const NOW = new Date('2026-11-07T03:00:00.000Z');
const TODAY = '2026-11-07';
const projects = [project({ id: 'p1', slug: 'brainct', name: 'BrainCT' }), project({ id: 'p2', slug: 'amgi', name: 'Amgi' })];
const item = { header: '📧 <b>Ed</b> · Review', from: 'Ed <ed@sender.example.org>', subject: 'BrainCT review', snippet: '10/30까지 회신 요청', link: 'https://mail.google.com/x' };

function alertDeps(over: { replies?: Parameters<typeof fakeClient>[0]; meta?: Record<string, unknown>; noClient?: boolean } = {}) {
  const { repo, meta } = fakeRepo({ projects, meta: over.meta });
  const fc = fakeClient(over.replies ?? [message([text('리뷰 요청, 10/30까지 회신')])]);
  const sends: Array<{ text: string; markup?: unknown }> = [];
  const deps: MailAlertDeps = {
    repo: repo as unknown as MailAlertDeps['repo'],
    client: over.noClient ? null : fc.client,
    today: TODAY,
    nowIso: NOW.toISOString(),
    send: async (t, markup) => (sends.push({ text: t, markup }), { ok: true }),
    env: {},
  };
  return { deps, meta, sends, calls: fc.calls, repo };
}

describe('summarizeMail', () => {
  it('Haiku summary, recorded in the ledger as feature mail', async () => {
    const a = alertDeps();
    expect(await summarizeMail(a.deps, item)).toBe('리뷰 요청, 10/30까지 회신');
    expect(a.calls[0]).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 200, thinking: { type: 'disabled' } });
    expect(a.calls[0].messages[0].content).toContain('10/30까지 회신 요청');
    const cycle = a.meta.get('ask:spend:2026-10-23') as SpendRecord;
    expect(cycle.byFeature.mail).toBeGreaterThan(0);
  });
  it('null without a client, when ahead of pace, exhausted, or empty', async () => {
    expect(await summarizeMail(alertDeps({ noClient: true }).deps, item)).toBeNull();
    for (const usd of [105, 100]) {
      const spent: SpendRecord = { usd, calls: 9, unpricedCalls: 0, byModel: {}, byFeature: {} };
      const a = alertDeps({ meta: { 'ask:spend:2026-10-23': spent } });
      expect(await summarizeMail(a.deps, item)).toBeNull();
      expect(a.calls).toHaveLength(0);
    }
    expect(await summarizeMail(alertDeps({ replies: [message([])] }).deps, item)).toBeNull();
  });
  it('the reserve is usable for mail: 95 spent late in the cycle is still under the mail limit', async () => {
    const spent: SpendRecord = { usd: 95, calls: 9, unpricedCalls: 0, byModel: {}, byFeature: {} };
    const a = alertDeps({ meta: { 'ask:spend:2026-10-23': spent } });
    a.deps.today = '2026-11-22';
    expect(await summarizeMail(a.deps, item)).not.toBeNull();
  });
});

describe('sendMailAlert', () => {
  it('summary line + buttons, pending record with the matched project', async () => {
    const a = alertDeps();
    await sendMailAlert(a.deps, item, '요약문', projects);
    expect(a.sends[0].text).toBe('📧 <b>Ed</b> · Review\n🧾 요약문');
    expect(a.sends[0].markup).toMatchObject({ inline_keyboard: [[{ text: '작업 준비 요청' }, { text: '답장 초안' }]] });
    const pending = [...a.meta].find(([k]) => k.startsWith('telegram:pending:'))![1] as MailPending;
    expect(pending).toMatchObject({ type: 'mail', projectId: 'p1', summary: '요약문', subject: 'BrainCT review' });
  });
  it('no summary: header only, buttons still there; escapes the summary', async () => {
    const a = alertDeps();
    await sendMailAlert(a.deps, item, null, projects);
    expect(a.sends[0].text).toBe(item.header);
    expect(a.sends[0].markup).toBeTruthy();
    await sendMailAlert(a.deps, item, '<script>', projects);
    expect(a.sends[1].text).toContain('&lt;script&gt;');
  });
  it('an explicit project id wins over keyword matching', async () => {
    const a = alertDeps();
    await sendMailAlert(a.deps, { ...item, projectId: 'p2' }, null, projects);
    expect(([...a.meta].find(([k]) => k.startsWith('telegram:pending:'))![1] as MailPending).projectId).toBe('p2');
  });
});

function callbackSetup(over: { replies?: Parameters<typeof fakeClient>[0]; projectId?: string | null; noClient?: boolean; ageHours?: number } = {}) {
  const a = alertDeps({ replies: over.replies });
  const record: MailPending = {
    type: 'mail',
    id: 'mail1',
    createdAt: new Date(NOW.getTime() - (over.ageHours ?? 1) * 3_600_000).toISOString(),
    from: item.from,
    subject: item.subject,
    snippet: item.snippet,
    link: item.link,
    summary: '리뷰 요청',
    projectId: over.projectId === undefined ? 'p1' : over.projectId,
  };
  a.meta.set('telegram:pending:mail1', record);
  const createNote = vi.fn(async () => ({ id: 'n1' }));
  const updateNote = vi.fn(async () => ({}));
  const answered: Array<string | undefined> = [];
  const sent: string[] = [];
  const markups: Array<{ text: string; markup: unknown }> = [];
  const deps = {
    repo: Object.assign(a.repo, { createNote, updateNote }),
    jev: null,
    askClient: over.noClient ? null : fakeClient(over.replies ?? [message([text('감사합니다. 10/30까지 회신드리겠습니다.')])]).client,
    send: async (t: string) => void sent.push(t),
    sendWithMarkup: async (t: string, m: unknown) => (markups.push({ text: t, markup: m }), { ok: true }),
    answer: async (_id: string, t?: string) => void answered.push(t),
    edit: async () => {},
    createNote: async () => ({}) as never,
    calendarCfg: null,
    now: () => NOW,
  } as unknown as AxDeps;
  return { deps, meta: a.meta, createNote, updateNote, answered, sent, markups };
}

describe('handleMailCallback', () => {
  it('작업 준비 요청 with a known project: one sent memo, second press is already handled', async () => {
    const s = callbackSetup();
    await handleMailCallback(s.deps, { callbackId: 'c1' }, { t: 'm', id: 'mail1', a: 'p' });
    await handleMailCallback(s.deps, { callbackId: 'c2' }, { t: 'm', id: 'mail1', a: 'p' });
    expect(s.createNote).toHaveBeenCalledTimes(1);
    expect(s.createNote).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', kind: 'memo', body: expect.stringContaining('[텔레그램 메일] 리뷰 요청') }));
    expect(s.updateNote).toHaveBeenCalledWith('n1', { status: 'sent' });
    expect(s.answered).toEqual(['보냈어요', '이미 처리됨']);
    expect(s.sent[0]).toContain('BrainCT');
  });

  it('no matched project: offers a pick keyboard, the pick sends the memo', async () => {
    const s = callbackSetup({ projectId: null });
    await handleMailCallback(s.deps, { callbackId: 'c1' }, { t: 'm', id: 'mail1', a: 'p' });
    expect(s.createNote).not.toHaveBeenCalled();
    expect(s.markups[0].text).toContain('어느 프로젝트');
    const rows = (s.markups[0].markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard.flat();
    expect(rows.map((b) => b.text)).toEqual(['BrainCT', 'Amgi']);
    await handleMailCallback(s.deps, { callbackId: 'c2' }, { t: 'm', id: 'mail1', a: 's', i: 1 });
    expect(s.createNote).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p2' }));
  });

  it('an out-of-range pick index asks again instead of writing', async () => {
    const s = callbackSetup({ projectId: null });
    await handleMailCallback(s.deps, { callbackId: 'c1' }, { t: 'm', id: 'mail1', a: 's', i: 5 });
    expect(s.createNote).not.toHaveBeenCalled();
  });

  it('답장 초안: code block, no repo write, claimed once', async () => {
    const s = callbackSetup();
    await handleMailCallback(s.deps, { callbackId: 'c1' }, { t: 'm', id: 'mail1', a: 'r' });
    expect(s.sent[0]).toContain('<pre>감사합니다. 10/30까지 회신드리겠습니다.</pre>');
    expect(s.sent[0]).toContain('Gmail에는 아무것도 쓰지 않았어요');
    expect(s.createNote).not.toHaveBeenCalled();
    await handleMailCallback(s.deps, { callbackId: 'c2' }, { t: 'm', id: 'mail1', a: 'r' });
    expect(s.answered.at(-1)).toBe('이미 처리됨');
  });

  it('draft failure releases the claim so a retry works', async () => {
    const s = callbackSetup({ noClient: true });
    await handleMailCallback(s.deps, { callbackId: 'c1' }, { t: 'm', id: 'mail1', a: 'r' });
    expect(s.answered[0]).toContain('초안을 만들 수 없어요');
    expect(s.meta.has('ax:applied:mail1:r')).toBe(false);
  });

  it('expired or unknown records answer 만료됨', async () => {
    const old = callbackSetup({ ageHours: 49 });
    await handleMailCallback(old.deps, { callbackId: 'c' }, { t: 'm', id: 'mail1', a: 'p' });
    await handleMailCallback(old.deps, { callbackId: 'c' }, { t: 'm', id: 'nope', a: 'p' });
    expect(old.answered).toEqual(['48시간이 지나 만료됐어요', '48시간이 지나 만료됐어요']);
    expect(old.createNote).not.toHaveBeenCalled();
    await handleMailCallback(old.deps, { callbackId: 'c' }, { t: 'm', id: 'mail1', a: 'r' });
    expect(old.answered.at(-1)).toBe('48시간이 지나 초안을 만들 수 없어요');
  });

  it('a 47-hour-old record still works', async () => {
    const s = callbackSetup({ ageHours: 47 });
    await handleMailCallback(s.deps, { callbackId: 'c' }, { t: 'm', id: 'mail1', a: 'p' });
    expect(s.createNote).toHaveBeenCalledTimes(1);
  });
});
