import { describe, expect, it } from 'vitest';
import {
  acceptButtonLabel,
  candidateHeadline,
  decideAccept,
  decideRevisionAccept,
  findMatchingPaper,
} from '@/lib/logic/review-candidates';
import type { Paper, ReviewCandidate, ReviewJob } from '@/lib/types';

function candidate(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    id: 'rc-1',
    account: 'main',
    messageId: 'm1',
    receivedAt: '2026-01-01T00:00:00Z',
    fromAddr: 'editor@fictional-journal.test',
    subject: 'Invitation to review',
    snippet: 'snippet',
    kind: 'invitation',
    journal: 'Fictional Journal',
    manuscriptId: 'FJ-2026-0001',
    title: 'A Fictional Title',
    dueDate: '2026-02-01',
    link: null,
    status: 'pending',
    reviewId: null,
    revisionType: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'paper1',
    title: 'A Fictional Title',
    shortName: 'FicTitle',
    stage: 'under_review',
    track: 'AI',
    journal: null,
    manuscriptId: null,
    targetJournals: [],
    folderPath: null,
    nextAction: null,
    projectId: null,
    submissions: [{ journal: 'Fictional Journal', submittedAt: '2026-01-01', decision: 'pending', decidedAt: null }],
    sort: 0,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function review(overrides: Partial<ReviewJob> = {}): ReviewJob {
  return {
    id: 'r1',
    journal: 'Fictional Journal',
    manuscriptId: 'FJ-2026-0001',
    title: null,
    status: 'invited',
    invitedAt: '2026-01-01T00:00:00Z',
    dueDate: null,
    link: null,
    note: null,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('decideAccept', () => {
  it('invitation with no existing review -> create as invited', () => {
    const decision = decideAccept(candidate({ kind: 'invitation' }), []);
    expect(decision).toEqual({
      mode: 'create',
      status: 'invited',
      journal: 'Fictional Journal',
      manuscriptId: 'FJ-2026-0001',
      title: 'A Fictional Title',
      dueDate: '2026-02-01',
    });
  });

  it('confirmation with no existing review -> create as accepted', () => {
    const decision = decideAccept(candidate({ kind: 'confirmation' }), []);
    expect(decision.mode).toBe('create');
    expect(decision.mode === 'create' && decision.status).toBe('accepted');
  });

  it('reminder with an existing same-manuscript review -> update it', () => {
    const existing = review();
    const decision = decideAccept(candidate({ kind: 'reminder', dueDate: '2026-03-01' }), [existing]);
    expect(decision).toEqual({ mode: 'update', reviewId: 'r1', status: 'accepted', dueDate: '2026-03-01' });
  });

  it('reminder with no existing review -> falls back to creating one as accepted', () => {
    const decision = decideAccept(candidate({ kind: 'reminder' }), []);
    expect(decision.mode).toBe('create');
    expect(decision.mode === 'create' && decision.status).toBe('accepted');
  });

  it('never matches an existing review when manuscriptId is null on either side', () => {
    const existing = review({ manuscriptId: null });
    const decision = decideAccept(candidate({ manuscriptId: null }), [existing]);
    expect(decision.mode).toBe('create');
  });

  it('invitation with an existing review keeps its current status, only updates due date', () => {
    const existing = review({ status: 'submitted', dueDate: '2026-01-15' });
    const decision = decideAccept(candidate({ kind: 'invitation', dueDate: null }), [existing]);
    expect(decision).toEqual({ mode: 'update', reviewId: 'r1', status: 'submitted', dueDate: '2026-01-15' });
  });
});

describe('acceptButtonLabel', () => {
  it('추가 when no matching review exists', () => {
    expect(acceptButtonLabel(candidate(), [])).toBe('추가');
  });

  it('기존 리뷰 갱신 when a same-manuscriptId review exists', () => {
    expect(acceptButtonLabel(candidate(), [review()])).toBe('기존 리뷰 갱신');
  });
});

describe('findMatchingPaper (Addendum A: revision candidates)', () => {
  it('matches by journal, case-insensitively', () => {
    const p = paper({ submissions: [{ journal: 'Fictional Journal', submittedAt: null, decision: null, decidedAt: null }] });
    const c = candidate({ kind: 'revision', journal: 'FICTIONAL JOURNAL', title: null });
    expect(findMatchingPaper(c, [p])).toBe(p);
  });

  it('matches by title when journal does not match', () => {
    const p = paper({ title: 'A Very Specific Fictional Title', submissions: [{ journal: 'Other Journal', submittedAt: null, decision: null, decidedAt: null }] });
    const c = candidate({ kind: 'revision', journal: 'Unrelated Journal', title: 'Very Specific Fictional Title' });
    expect(findMatchingPaper(c, [p])).toBe(p);
  });

  it('returns null when neither journal nor title matches', () => {
    const p = paper();
    const c = candidate({ kind: 'revision', journal: 'Nope', title: 'Also nope' });
    expect(findMatchingPaper(c, [p])).toBeNull();
  });
});

describe('decideRevisionAccept', () => {
  it('major revisionType -> major decision on the latest submission', () => {
    const p = paper({ submissions: [
      { journal: 'J1', submittedAt: null, decision: null, decidedAt: null },
      { journal: 'J2', submittedAt: null, decision: null, decidedAt: null },
    ] });
    const decision = decideRevisionAccept(candidate({ revisionType: 'major' }), p);
    expect(decision).toEqual({ paperId: 'paper1', submissionIndex: 1, decision: 'major', deadlineTitle: 'FicTitle 리비전 제출' });
  });

  it('null revisionType defaults to major', () => {
    const decision = decideRevisionAccept(candidate({ revisionType: null }), paper());
    expect(decision?.decision).toBe('major');
  });

  it('minor revisionType -> minor decision', () => {
    const decision = decideRevisionAccept(candidate({ revisionType: 'minor' }), paper());
    expect(decision?.decision).toBe('minor');
  });

  it('null when the paper has no submissions', () => {
    expect(decideRevisionAccept(candidate(), paper({ submissions: [] }))).toBeNull();
  });
});

describe('candidateHeadline', () => {
  const today = '2026-01-01';

  it('invitation with a due date', () => {
    const c = candidate({ kind: 'invitation', journal: 'Fictional Journal', dueDate: '2026-01-20' });
    expect(candidateHeadline(c, null, today)).toBe('Fictional Journal에서 리뷰 초대 · 마감 1월 20일 (화) (D-19)');
  });

  it('invitation with no due date omits the suffix', () => {
    const c = candidate({ kind: 'invitation', journal: 'Fictional Journal', dueDate: null });
    expect(candidateHeadline(c, null, today)).toBe('Fictional Journal에서 리뷰 초대');
  });

  it('reminder', () => {
    const c = candidate({ kind: 'reminder', journal: 'Fictional Journal', dueDate: '2026-01-04' });
    expect(candidateHeadline(c, null, today)).toBe('Fictional Journal 리뷰 마감 알림 · D-3');
  });

  it('confirmation', () => {
    const c = candidate({ kind: 'confirmation', journal: 'Fictional Journal' });
    expect(candidateHeadline(c, null, today)).toBe('Fictional Journal 리뷰 수락 확인됨');
  });

  it('revision with a matched paper', () => {
    const p = paper({ shortName: 'FicTitle' });
    const c = candidate({ kind: 'revision', revisionType: 'major', dueDate: '2026-03-01' });
    expect(candidateHeadline(c, p, today)).toBe('FicTitle · Major revision 요청 · 제출 기한 3월 1일 (일) (D-59)');
  });

  it('revision with no matched paper asks which one', () => {
    const c = candidate({ kind: 'revision', dueDate: null });
    expect(candidateHeadline(c, null, today)).toBe('어느 논문인가요? · Major revision 요청');
  });

  it('other kind is a generic prompt', () => {
    const c = candidate({ kind: 'other' });
    expect(candidateHeadline(c, null, today)).toBe('리뷰 관련 메일 · 확인 필요');
  });
});
