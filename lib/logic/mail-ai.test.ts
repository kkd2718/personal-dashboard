import { describe, expect, it } from 'vitest';
import { project } from '@/lib/logic/ax-fixtures';
import { decodeCallback, encodeCallback } from '@/lib/logic/ax-proposal';
import { cleanSummary, findProjectInText, mailKeyboard, mailMemoBody, mailPrompt, pickKeyboard } from './mail-ai';

const projects = [
  project({ id: 'p1', slug: 'brainct', name: 'BrainCT', aliases: ['브레인'] }),
  project({ id: 'p2', slug: 'ct', name: 'CT' }),
  project({ id: 'p3', slug: 'old-proj', name: 'OldProject', status: 'archived' }),
];

describe('cleanSummary', () => {
  it('trims quotes and keeps two lines', () => {
    expect(cleanSummary('"리뷰 요청: 10/30까지 회신"')).toBe('리뷰 요청: 10/30까지 회신');
    expect(cleanSummary('a\n\nb\nc')).toBe('a\nb');
  });
  it('strips markdown the model slipped in', () => {
    expect(cleanSummary('**무엇:** 리뷰 요청. **언제까지:** 10/30')).toBe('무엇: 리뷰 요청. 언제까지: 10/30');
    expect(cleanSummary('- 첫째\n- 둘째')).toBe('첫째\n둘째');
  });
  it('rejects empty or absurdly long', () => {
    expect(cleanSummary('  ')).toBeNull();
    expect(cleanSummary(null)).toBeNull();
    expect(cleanSummary('x'.repeat(401))).toBeNull();
  });
});

describe('findProjectInText', () => {
  it('matches slug/name/alias, longest key wins, skips short keys and archived projects', () => {
    expect(findProjectInText(projects, 'Re: BrainCT revision')?.id).toBe('p1');
    expect(findProjectInText(projects, '브레인 데이터')?.id).toBe('p1');
    expect(findProjectInText(projects, 'CT 일정')).toBeNull(); // 'ct' is too short to trust
    expect(findProjectInText(projects, 'OldProject 문의')).toBeNull();
  });
});

describe('callbacks and keyboards', () => {
  it('encode/decode roundtrip for the three mail actions', () => {
    for (const c of [
      { t: 'm', id: 'abc123', a: 'p' },
      { t: 'm', id: 'abc123', a: 'r' },
      { t: 'm', id: 'abc123', a: 's', i: 7 },
    ] as const) expect(decodeCallback(encodeCallback(c))).toEqual(c);
    expect(decodeCallback('m:abc:zzz')).toBeNull();
  });
  it('callback data stays within Telegram 64 bytes', () => {
    const kb = pickKeyboard('abcdefghij', projects);
    for (const row of [...mailKeyboard('abcdefghij').inline_keyboard, ...kb.inline_keyboard]) {
      for (const b of row) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    }
  });
  it('pick keyboard lays out two per row, max 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => project({ id: `p${i}`, slug: `s${i}`, name: `N${i}` }));
    const rows = pickKeyboard('id', many).inline_keyboard;
    expect(rows.flat()).toHaveLength(8);
    expect(rows[0]).toHaveLength(2);
  });
});

describe('prompt and memo body', () => {
  const m = { from: 'Ed <ed@sender.example.org>', subject: 'Review request', snippet: '', link: 'https://mail.google.com/x', summary: '리뷰 요청' };
  it('prompt marks a missing snippet', () => {
    expect(mailPrompt(m)).toContain('발췌: (없음)');
    expect(mailPrompt(m, '요약문')).toContain('요약: 요약문');
  });
  it('memo body carries summary, sender, subject and link', () => {
    expect(mailMemoBody(m)).toBe('[텔레그램 메일] 리뷰 요청\n보낸이: Ed <ed@sender.example.org>\n제목: Review request\nhttps://mail.google.com/x');
    expect(mailMemoBody({ ...m, summary: null, link: null })).toBe('[텔레그램 메일] Review request\n보낸이: Ed <ed@sender.example.org>\n제목: Review request');
  });
});
