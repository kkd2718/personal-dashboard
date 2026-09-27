import { describe, expect, it } from 'vitest';
import { parseReviewMail } from '@/lib/logic/review-mail';

// All journals/people/ids/domains below are fictional — see docs/PLAN_3.md §7 and
// scripts/check-isolation.mjs. receivedAt is fixed so relative due-date fixtures
// have a deterministic expected result.
const RECEIVED = '2026-09-20T02:00:00.000Z'; // -> 2026-09-20 KST-adjacent enough for these tests

describe('parseReviewMail — positive: invitation', () => {
  it('ScholarOne-style id, [Journal] bracket, quoted title, day-Mon-year due date', () => {
    const result = parseReviewMail({
      from: '"Journal of Fictional Medicine" <em@fictional-journal-press.test>',
      subject: '[Journal of Fictional Medicine] Invitation to review manuscript FICM-2026-0456',
      body:
        'Dear colleague,\n\n' +
        'You are invited to review the manuscript entitled "Effects of Fictional Compound X on Model Organisms" ' +
        '(ID FICM-2026-0456) for the Journal of Fictional Medicine.\n\n' +
        'Please complete your review by 15-Oct-2026.\n\n' +
        'You can access the manuscript here: https://review.fictional-journal-press.test/manuscript/456\n\n' +
        'Thank you.',
      receivedAt: RECEIVED,
    });
    expect(result).toEqual({
      kind: 'invitation',
      manuscriptId: 'FICM-2026-0456',
      journal: 'Journal of Fictional Medicine',
      title: 'Effects of Fictional Compound X on Model Organisms',
      dueDate: '2026-10-15',
      link: 'https://review.fictional-journal-press.test/manuscript/456',
      revisionType: null,
    });
  });

  it('JMIR-style id, sender display name as journal fallback, "Month Day, Year" due date', () => {
    const result = parseReviewMail({
      from: '"JMIR Editorial Office" <em@jmir-manuscript-central.test>',
      subject: 'Reviewer Invitation - JMIR #58421',
      body:
        'Dear Reviewer,\n\n' +
        'We would be grateful if you would be willing to review the manuscript titled ' +
        '"A Fictional Approach to Data Privacy" for consideration in our journal.\n\n' +
        'Manuscript: JMIR #58421\n\n' +
        'Your review is due by Oct 15, 2026.\n\n' +
        'Review link: https://mc.manuscriptcentral.test/jmir/reviewer/58421\n\n' +
        'Regards,\nEditorial Office',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('invitation');
    expect(result?.manuscriptId).toBe('JMIR-58421');
    expect(result?.journal).toBe('JMIR Editorial Office');
    expect(result?.title).toBe('A Fictional Approach to Data Privacy');
    expect(result?.dueDate).toBe('2026-10-15');
    expect(result?.link).toBe('https://mc.manuscriptcentral.test/jmir/reviewer/58421');
  });

  it('MDPI-style manuscripts-N id, "on behalf of" journal, "D Month Year" due date', () => {
    const result = parseReviewMail({
      from: '"MDPI Fictional Materials Editorial Office" <materials@mdpi-fictional.test>',
      subject: 'Review Request: Journal of Fictional Materials',
      body:
        'Dear Dr. Reviewer,\n\n' +
        'On behalf of the Journal of Fictional Materials, we kindly ask if you would be willing to review ' +
        'manuscripts-88213.\n\n' +
        'The review deadline is 15 October 2026.\n\n' +
        'Assignment link: https://susy.mdpi-fictional.test/assignment/88213\n\n' +
        'Best regards',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('invitation');
    expect(result?.manuscriptId).toBe('manuscripts-88213');
    expect(result?.journal).toBe('Journal of Fictional Materials');
    expect(result?.dueDate).toBe('2026-10-15');
    expect(result?.link).toBe('https://susy.mdpi-fictional.test/assignment/88213');
  });

  it('ISO due date + Korean 심사 의뢰 kind + [bracket] Korean journal + quoted Korean title', () => {
    const result = parseReviewMail({
      from: '"한국어저널 편집부" <editor@kjournal-fictional.test>',
      subject: '[한국어저널] 논문 심사 의뢰',
      body:
        '안녕하세요,\n\n' +
        '귀하께 다음 논문에 대한 심사를 의뢰 드립니다: "가상의 재료에 관한 연구" (ABCD-2026-7890).\n\n' +
        '심사 마감(deadline): 2026-10-15\n\n' +
        '리뷰 링크: https://review.kjournal-fictional.test/manuscript/7890',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('invitation');
    expect(result?.manuscriptId).toBe('ABCD-2026-7890');
    expect(result?.journal).toBe('한국어저널');
    expect(result?.title).toBe('가상의 재료에 관한 연구');
    expect(result?.dueDate).toBe('2026-10-15');
    expect(result?.link).toBe('https://review.kjournal-fictional.test/manuscript/7890');
  });

  it('US-order M/D/Y due date, ABC-D-YY-NNNNN manuscript id', () => {
    const result = parseReviewMail({
      from: '"Fictional Applied Physics" <office@fictional-physics-press.test>',
      subject: 'Invitation to review — Fictional Applied Physics',
      body:
        'You are invited to review manuscript FAP-R-26-00123 for Fictional Applied Physics.\n\n' +
        'Reviews must be submitted by 10/15/2026.\n\n' +
        'Manuscript link: https://review.fictional-physics-press.test/manuscript/123',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('invitation');
    expect(result?.manuscriptId).toBe('FAP-R-26-00123');
    expect(result?.dueDate).toBe('2026-10-15');
  });

  it('relative due date: "within N days"', () => {
    const result = parseReviewMail({
      from: '"Fictional Neuroscience Reports" <editor@fictional-neuro.test>',
      subject: 'Invitation to review – Fictional Neuroscience Reports',
      body:
        'Hello,\n\n' +
        'You are invited to review the manuscript "Synaptic Plasticity in Fictional Models" ' +
        '(FNR-2026-1122) for Fictional Neuroscience Reports.\n\n' +
        'Please submit your review within 14 days of this email.\n\n' +
        'Review here: https://review.fictional-neuro.test/manuscript/1122',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('invitation');
    expect(result?.journal).toBe('Fictional Neuroscience Reports');
    expect(result?.title).toBe('Synaptic Plasticity in Fictional Models');
    expect(result?.dueDate).toBe('2026-10-04'); // 2026-09-20 + 14 days
  });

  it('relative due date: "in N days", no title given', () => {
    const result = parseReviewMail({
      from: '"Fictional Botany Letters" <editors@fictional-botany.test>',
      subject: 'Invitation to review for Fictional Botany Letters',
      body:
        'Dear colleague,\n\n' +
        'Kindly complete your review in 10 days.\n\n' +
        'Manuscript FBL-2026-4471. Link: https://review.fictional-botany.test/manuscript/4471',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('invitation');
    expect(result?.manuscriptId).toBe('FBL-2026-4471');
    expect(result?.title).toBeNull();
    expect(result?.dueDate).toBe('2026-09-30'); // 2026-09-20 + 10 days
  });
});

describe('parseReviewMail — positive: reminder / confirmation', () => {
  it('reminder: overdue', () => {
    const result = parseReviewMail({
      from: '"Fictional Cell Biology" <noreply@fictional-cellbio.test>',
      subject: 'REMINDER: Your review is overdue',
      body:
        'Dear Reviewer,\n\nYour review of manuscript FCB-2026-9981 for Fictional Cell Biology is now overdue.\n\n' +
        'Please submit as soon as possible: https://review.fictional-cellbio.test/manuscript/9981',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('reminder');
    expect(result?.manuscriptId).toBe('FCB-2026-9981');
  });

  it('reminder: "Reminder: ... review" with a due-by date', () => {
    const result = parseReviewMail({
      from: '"Fictional Energy Journal" <em@fictional-energy-press.test>',
      subject: 'Reminder: outstanding review for Fictional Energy Journal',
      body:
        'This is a reminder that your review of manuscript FEJ-2026-1200 is due by 2026-10-05.\n\n' +
        'Link: https://review.fictional-energy-press.test/manuscript/1200',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('reminder');
    expect(result?.dueDate).toBe('2026-10-05');
  });

  it('confirmation: thank you for agreeing to review', () => {
    const result = parseReviewMail({
      from: '"Fictional Genetics Quarterly" <em@fictional-genetics.test>',
      subject: 'Thank you for agreeing to review',
      body:
        'Dear Reviewer,\n\nThank you for agreeing to review manuscript FGQ-2026-3301 for Fictional Genetics Quarterly.\n\n' +
        'Your due date is 2026-11-01.',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('confirmation');
    expect(result?.manuscriptId).toBe('FGQ-2026-3301');
    expect(result?.dueDate).toBe('2026-11-01');
  });

  it('confirmation: accepted the invitation to review', () => {
    const result = parseReviewMail({
      from: '"Fictional Soil Science" <editors@fictional-soilsci.test>',
      subject: 'Confirmation: you accepted the invitation to review',
      body: 'You have accepted the invitation to review manuscript FSS-2026-7712.',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('confirmation');
  });
});

describe('parseReviewMail — Addendum A: revision letters on the user\'s own paper', () => {
  it('major revision, forwarded mail, "within N days" due date', () => {
    const result = parseReviewMail({
      from: '"Fictional Professor" <professor@fictional-university.test>',
      subject: 'Fwd: Decision on your manuscript FOM-2026-4471',
      body:
        '---------- Forwarded message ----------\n' +
        'From: Fictional Oncology Journal <em@fictional-oncology-press.test>\n' +
        'Subject: Decision on your manuscript FOM-2026-4471\n\n' +
        'Dear Author,\n\nWe have reached a decision on your manuscript entitled "Fictional Tumor Markers Study" ' +
        '(FOM-2026-4471) for Fictional Oncology Journal: Major Revision.\n\n' +
        'Please submit your revision within 60 days.',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('revision');
    expect(result?.revisionType).toBe('major');
    expect(result?.manuscriptId).toBe('FOM-2026-4471');
    expect(result?.title).toBe('Fictional Tumor Markers Study');
    expect(result?.dueDate).toBe('2026-11-19'); // 2026-09-20 + 60 days
  });

  it('minor revision with an explicit due-by date', () => {
    const result = parseReviewMail({
      from: '"Fictional Professor" <professor@fictional-university.test>',
      subject: 'Fwd: Your manuscript requires minor revision',
      body:
        'Fwd from Fictional Botany Reports:\n\n' +
        'Your manuscript FBR-2026-1188 requires minor revision. ' +
        'Please submit your revised manuscript by 2026-11-01.',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('revision');
    expect(result?.revisionType).toBe('minor');
    expect(result?.dueDate).toBe('2026-11-01');
  });

  it('revise and resubmit is treated as a major revision', () => {
    const result = parseReviewMail({
      from: '"Fictional Professor" <professor@fictional-university.test>',
      subject: 'Fwd: Editorial decision',
      body: 'The editor has decided: revise and resubmit your manuscript FGE-2026-9021.',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('revision');
    expect(result?.revisionType).toBe('major');
  });

  it('Korean 수정 후 재심 with ambiguous (null) revision type', () => {
    const result = parseReviewMail({
      from: '"Fictional Professor" <professor@fictional-university.test>',
      subject: '전달: 논문 심사 결과',
      body: '귀하의 논문 FKJ-2026-3321에 대해 수정 후 재심 결정되었습니다.',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('revision');
    expect(result?.revisionType).toBeNull();
  });

  it('journal extraction stops at a colon (e.g. "for <Journal>: Major Revision")', () => {
    const result = parseReviewMail({
      from: '"Fictional Professor" <professor@fictional-university.test>',
      subject: 'Fwd: Decision on your manuscript',
      body:
        'Dear Author,\n\nWe have reached a decision on your manuscript entitled "Fictional Genome Study" ' +
        'for Fictional Genomics Journal: Major Revision.\n\nPlease submit your revision within 45 days.',
      receivedAt: RECEIVED,
    });
    expect(result?.journal).toBe('Fictional Genomics Journal');
  });

  it('a plain accept/reject decision (no revise wording) still stays null', () => {
    const result = parseReviewMail({
      from: '"Fictional Oncology Journal" <em@fictional-oncology-press.test>',
      subject: 'Decision on your manuscript FOM-2026-4471',
      body: 'We have reached a decision on your manuscript: Accept.',
      receivedAt: RECEIVED,
    });
    expect(result).toBeNull();
  });
});

describe('parseReviewMail — ambiguous reviewer-related -> other', () => {
  it('mentions review + a manuscript id, no invitation/reminder/confirmation language', () => {
    const result = parseReviewMail({
      from: 'Editorial Office <eo@fictional-journal.test>',
      subject: 'Regarding the review of FJS-2026-0042',
      body: 'Dear colleague,\n\nA quick note about the review of FJS-2026-0042.',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('other');
  });

  it('vague review mention without a manuscript id -> null', () => {
    const result = parseReviewMail({
      from: '"Fictional Journal of Statistics" <office@fictional-stats-press.test>',
      subject: 'Following up on the review process',
      body:
        'Dear colleague,\n\nWe are reaching out about the review process for our journal. ' +
        'Please let us know if you have any questions.',
      receivedAt: RECEIVED,
    });
    expect(result).toBeNull();
  });

  it('editing-service marketing that mentions 심사 의견 -> null', () => {
    const result = parseReviewMail({
      from: '"Fictional Editing" <news@editage.com>',
      subject: '[Fictional Editing] 재투고 전, 답변서가 모든 심사 의견에 답하는지 확인하세요',
      body: '심사 의견 대응 서비스 안내 FJS-2026-0042',
      receivedAt: RECEIVED,
    });
    expect(result).toBeNull();
  });
});

describe('parseReviewMail — negative classes -> null (never stored)', () => {
  it('call for reviewers (conference-style campaign)', () => {
    const result = parseReviewMail({
      from: '"Fictional Medical Imaging Conference" <no-reply@fictional-imaging-conf.test>',
      subject: 'FMIC 2026 — Call for Reviewers',
      body: 'We are recruiting reviewers for FMIC 2026. Apply to review at https://fictional-imaging-conf.test/apply',
      receivedAt: RECEIVED,
    });
    expect(result).toBeNull();
  });

  it('invitation to contribute an article (publisher solicitation)', () => {
    const result = parseReviewMail({
      from: '"Fictional Publishing Group" <marketing@fictional-publishing.test>',
      subject: 'We would like to invite you to contribute an Article',
      body: 'Dear Dr., we invite you to contribute an Article to our upcoming Special Issue on Fictional Topics.',
      receivedAt: RECEIVED,
    });
    expect(result).toBeNull();
  });

  it('invitation to contribute a Review (collection solicitation)', () => {
    const result = parseReviewMail({
      from: '"Fictional Collections Team" <collections@fictional-springer-like.test>',
      subject: 'Contribute a Review to our new Article Collection',
      body: 'You are invited to contribute a Review to our new Article Collection as guest editor.',
      receivedAt: RECEIVED,
    });
    expect(result).toBeNull();
  });

  it('issue alert / table of contents (ClinicalKey-style)', () => {
    const result = parseReviewMail({
      from: '"Fictional ClinicalAlert" <alerts@fictional-clinicalalert.test>',
      subject: 'Table of Contents Alert: New issue of Fictional Lancet-like Journal',
      body: 'A new issue of the journal is now available. View the table of contents online.',
      receivedAt: RECEIVED,
    });
    expect(result).toBeNull();
  });

  it("co-author's manuscript-received acknowledgement (own paper, ScholarOne-style)", () => {
    const result = parseReviewMail({
      from: '"Fictional Journal of Oncology" <onbehalfof@manuscriptcentral-fictional.test>',
      subject: 'Manuscript Received - FJO-2026-5541',
      body: 'Dear Author,\n\nThis is to confirm that your manuscript has been received by Fictional Journal of Oncology.',
      receivedAt: RECEIVED,
    });
    expect(result).toBeNull();
  });

  it("decision on the user's own manuscript", () => {
    const result = parseReviewMail({
      from: '"Fictional Journal of Oncology" <em@fictional-oncology-press.test>',
      subject: 'Decision on your manuscript FJO-2026-5541',
      body: 'We have reached a decision on your manuscript entitled "A Study of Fictional Things".',
      receivedAt: RECEIVED,
    });
    expect(result).toBeNull();
  });

  it('not reviewer-related at all', () => {
    const result = parseReviewMail({
      from: '"Fictional Supplies Co" <orders@fictional-supplies.test>',
      subject: 'Your order has shipped',
      body: 'Your recent order #4821 has shipped and will arrive within 3 business days.',
      receivedAt: RECEIVED,
    });
    expect(result).toBeNull();
  });
});

describe('parseReviewMail — owner rules: MDPI ignored, submitted-review thank-you', () => {
  it('drops reviewer mail sent from an mdpi.com address', () => {
    const result = parseReviewMail({
      from: '"Fictional Editorial Office" <fictional-office@mdpi.com>',
      subject: 'Invitation to review manuscripts-12345',
      body: 'Dear Dr. Reviewer,\n\nWould you be willing to review manuscripts-12345? Due within 10 days.',
      receivedAt: RECEIVED,
    });
    expect(result).toBeNull();
  });

  it('still keeps a revision letter from an mdpi.com address (the owner\'s own paper)', () => {
    const result = parseReviewMail({
      from: 'Fictional Office <office@mdpi.com>',
      subject: 'Decision on manuscripts-12345: minor revision',
      body: 'Dear Author,\n\nYour manuscript requires minor revision. Please resubmit within 10 days.',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('revision');
  });

  it('a non-MDPI address that merely contains "mdpi" is not dropped', () => {
    const result = parseReviewMail({
      from: 'Editor <editor@notmdpi-fictional.test>',
      subject: 'Invitation to review',
      body: 'Would you be willing to review this manuscript?',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('invitation');
  });

  it('"Thank you for your review" -> completed, even when it quotes "manuscript received"', () => {
    const result = parseReviewMail({
      from: '"Fictional Pediatric Imaging" <em@fictional-peds.test>',
      subject: 'Thank you for your review of FPI-D-26-00412',
      body:
        'Dear Dr. Reviewer,\n\nThank you for your review of manuscript FPI-D-26-00412. ' +
        'Your comments on the manuscript have been received and forwarded to the editor.',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('completed');
    expect(result?.manuscriptId).toBe('FPI-D-26-00412');
  });

  it('"your review has been submitted" -> completed', () => {
    const result = parseReviewMail({
      from: 'Editorial Office <eo@fictional-journal.test>',
      subject: 'Review submitted',
      body: 'Your review has been submitted successfully. Thank you.',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('completed');
  });
});

describe('parseReviewMail — forwarded revision letters (professor note on top)', () => {
  it('Editorial Manager id -> journal code, EMID bracket ignored, Korean "M월 D일까지" due date', () => {
    const result = parseReviewMail({
      from: 'Fictional Professor <professor@fictional-university.test>',
      subject: 'Fwd: Editorial Decision on Manuscript FICSCI-D-26-01234 - [EMID:0123abcd4567ef89]',
      body:
        '축하드립니다. major revision입니다. 10월 17일까지 입니다.\n\n' +
        '---------- Forwarded message ---------\nSent: Sep 17, 2026 by Editorial Office\n' +
        'Manuscript FICSCI-D-26-01234 requires major revision.',
      receivedAt: '2026-09-18T01:04:55.000Z',
    });
    expect(result?.kind).toBe('revision');
    expect(result?.journal).toBe('FICSCI');
    expect(result?.dueDate).toBe('2026-10-17');
  });

  it('"Fwd: <Journal>: Decision on your manuscript" subject -> journal', () => {
    const result = parseReviewMail({
      from: 'Fictional Professor <professor@fictional-university.test>',
      subject: 'Fwd: npj Fictional Medicine: Decision on your manuscript',
      body: 'revision이 왔습니다. Reviewer 1 has concerns. Please revise the manuscript.',
      receivedAt: RECEIVED,
    });
    expect(result?.kind).toBe('revision');
    expect(result?.journal).toBe('npj Fictional Medicine');
  });

  it('an absolute date before the mail was received is not a due date', () => {
    const result = parseReviewMail({
      from: 'Editor <eo@fictional-journal.test>',
      subject: 'Invitation to review',
      body: 'Would you be willing to review? Sent by the office on 2026-09-01.',
      receivedAt: RECEIVED,
    });
    expect(result?.dueDate).toBeNull();
  });
});

describe('parseReviewMail — long forwarded letter trimmed by the Apps Script', () => {
  it('reads "Deadline: D Mon YYYY" from the hint lines appended after the first 3000 chars', () => {
    const comments =
      'Reviewer 1\nI appreciate the efforts, but due to the limited cohort I still have concerns. ' +
      'The model was trained in 2019 and validated by two readers. '.repeat(45);
    const body = 'revision이 왔습니다. R1은 여전히 우려를 제기하네요.\n' + comments.slice(0, 2950) + '\n…\nDeadline: 22 Oct 2026';
    const result = parseReviewMail({
      from: 'Fictional Professor <professor@fictional-university.test>',
      subject: 'Fwd: npj Fictional Medicine: Decision on your manuscript',
      body,
      receivedAt: '2026-09-24T01:58:56.000Z',
    });
    expect(result?.kind).toBe('revision');
    expect(result?.dueDate).toBe('2026-10-22');
  });
});
