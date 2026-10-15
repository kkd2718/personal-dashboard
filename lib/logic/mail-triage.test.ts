import { describe, expect, it } from 'vitest';
import { formatMailAlert } from '@/lib/telegram/format';
import {
  applyMailRule,
  crossAccountKey,
  matchesSender,
  normalizeTriageConfig,
  parseMailRule,
  rememberSeen,
  senderAddress,
  stripAttachmentNames,
  triageDecision,
  triageState,
  unseen,
  type TriageMail,
} from './mail-triage';

const mail = (o: Partial<TriageMail> = {}): TriageMail => ({
  messageId: 'm1',
  threadId: 't1',
  from: 'Editor <editor@journal.example.org>',
  subject: 'Decision on X',
  receivedAt: '2026-10-15T00:00:00.000Z',
  link: 'https://mail.google.com/mail/#all/t1',
  ...o,
});
const cfg = (o: Partial<ReturnType<typeof normalizeTriageConfig>> = {}) => ({ allow: [], deny: [], noBodyAccounts: [], ...o });

describe('sender matching', () => {
  it('senderAddress', () => {
    expect(senderAddress('Kim <A@B.com>')).toBe('a@b.com');
    expect(senderAddress('plain@b.com')).toBe('plain@b.com');
  });
  it('matchesSender: exact, domain, sub-domain', () => {
    expect(matchesSender('x@mail.b.com', ['b.com'])).toBe(true);
    expect(matchesSender('x@b.com', ['@b.com'])).toBe(true);
    expect(matchesSender('x@b.com', ['c.com'])).toBe(false);
    expect(matchesSender('x@b.com', ['x@b.com'])).toBe(true);
    expect(matchesSender('y@b.com', ['x@b.com'])).toBe(false);
    expect(matchesSender('x@notb.com', ['b.com'])).toBe(false);
  });
  it('deny wins over allow', () => {
    const c = cfg({ allow: ['example.org'], deny: ['editor@journal.example.org'] });
    expect(triageDecision(mail(), c)).toBe('deny');
    expect(triageDecision(mail({ from: 'other@journal.example.org' }), c)).toBe('allow');
    expect(triageDecision(mail({ from: 'x@elsewhere.test' }), c)).toBe('ask');
  });
});

describe('dedupe', () => {
  it('unseen drops seen ids and in-batch duplicates', () => {
    expect(unseen([mail(), mail({ messageId: 'm2' }), mail({ messageId: 'm2' })], ['m1']).map((m) => m.messageId)).toEqual(['m2']);
  });
  it('the seen ring keeps the newest 1000', () => {
    const ring = rememberSeen(Array.from({ length: 1000 }, (_, i) => `o${i}`), ['new']);
    expect(ring).toHaveLength(1000);
    expect(ring[0]).toBe('o1');
    expect(ring.at(-1)).toBe('new');
  });
  it('crossAccountKey ignores Re:/Fwd: and case', () => {
    expect(crossAccountKey(mail({ subject: 'Fwd: RE:  decision on x' }))).toBe(crossAccountKey(mail()));
  });
});

describe('text helpers', () => {
  it('stripAttachmentNames', () => {
    expect(stripAttachmentNames('첨부: 검사결과_환자.pdf 확인 부탁')).toBe('첨부: 확인 부탁');
    expect(stripAttachmentNames('see report.docx and scan.dcm')).toBe('see and');
    expect(stripAttachmentNames('plain text stays')).toBe('plain text stays');
  });
  it('triageState omits 내용 without a snippet', () => {
    expect(triageState(mail())).not.toContain('내용:');
    expect(triageState(mail({ snippet: 'hello' }))).toContain('\n내용: hello');
  });
  it('formatMailAlert batches at most 5, with a snippet line and the link', () => {
    const many = Array.from({ length: 7 }, (_, i) => mail({ messageId: `m${i}`, snippet: i === 0 ? 'first line' : undefined }));
    const text = formatMailAlert(many);
    expect(text).toContain('📧 <b>Editor</b> · Decision on X\nfirst line\nhttps://mail.google.com/');
    expect(text).toContain('…외 2건');
    expect(text.match(/📧/g)).toHaveLength(5);
  });
});

describe('/mailrule', () => {
  it('parses', () => {
    expect(parseMailRule('')).toEqual({ kind: 'list' });
    expect(parseMailRule('allow A@B.com')).toEqual({ kind: 'allow', pattern: 'a@b.com' });
    expect(parseMailRule('deny @x.com')).toEqual({ kind: 'deny', pattern: '@x.com' });
    expect(parseMailRule('allow')).toEqual({ kind: 'invalid' });
    expect(parseMailRule('allow a b')).toEqual({ kind: 'invalid' });
  });
  it('a rule moves a pattern between lists', () => {
    let c = applyMailRule(cfg(), { kind: 'allow', pattern: 'a@b.com' });
    expect(c.allow).toEqual(['a@b.com']);
    c = applyMailRule(c, { kind: 'deny', pattern: 'a@b.com' });
    expect(c).toMatchObject({ allow: [], deny: ['a@b.com'] });
    expect(applyMailRule(c, { kind: 'remove', pattern: 'a@b.com' })).toMatchObject({ allow: [], deny: [] });
  });
});
