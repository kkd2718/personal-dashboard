// Pure Gmail review-invitation detector (phase 3). No repo/network access — the
// mail body itself is only ever passed in and read here; callers must never
// persist it (only the parsed fields + a short snippet, see lib/google/sync.ts).
import { addDaysStr } from '@/lib/logic/dates';

// 'revision' (Addendum A): editorial decision letters on the user's own paper
// asking for major/minor revision — wanted, unlike plain accept/reject/received
// notices (which stay null, see NEGATIVE_PATTERNS below).
export type ReviewMailKind = 'invitation' | 'reminder' | 'confirmation' | 'completed' | 'revision' | 'other';

export interface ParsedReviewMail {
  kind: ReviewMailKind;
  manuscriptId: string | null;
  journal: string | null;
  title: string | null;
  dueDate: string | null; // 'YYYY-MM-DD'
  link: string | null;
  revisionType: 'major' | 'minor' | null; // kind === 'revision' only
}

export interface ReviewMailInput {
  from: string;
  subject: string;
  body: string;
  receivedAt: string; // ISO instant
}

// --- negative classes: never stored, even though they mention "review" --------

const NEGATIVE_PATTERNS: RegExp[] = [
  /call for reviewers?/i,
  /apply to (?:become a |be a )?reviewer/i,
  /become a reviewer/i,
  /join (?:our|the) (?:editorial board|reviewer (?:pool|panel|database))/i,
  /invit(?:e|es|ed|ing) (?:you )?to (?:contribute|submit)\b/i,
  /would you (?:like|be willing) to (?:contribute|submit) an? (?:article|paper|review article)\b/i,
  /special issue/i,
  /article collection/i,
  /guest editor/i,
  /table of contents/i,
  /new issue (?:of|:)/i,
  /issue alert/i,
  /manuscript (?:has been )?(?:received|submitted)\b/i,
  /thank you for (?:your submission|submitting your manuscript)/i,
  /decision (?:on|regarding|has been made) your manuscript/i,
  /editor.?s? decision on your (?:manuscript|submission)/i,
];

// --- positive kinds, most-specific first ---------------------------------

// The journal's thank-you after the user submitted a review. Checked before the
// negative classes: these mails often also quote "manuscript ... received".
const COMPLETED_PATTERNS: RegExp[] = [
  /thank you for (?:your|completing|submitting)(?: your)? review\b/i,
  /(?:we have|we've) received your review/i,
  /your review (?:has been|was) (?:received|submitted)/i,
];

const CONFIRMATION_PATTERNS: RegExp[] = [
  /thank you for agreeing to review/i,
  /accepted the invitation (?:to review)?/i,
  /you have agreed to review/i,
  /confirms? (?:that )?you(?:'ve| have)? agreed to review/i,
];

const REMINDER_PATTERNS: RegExp[] = [
  /review is (?:now )?(?:overdue|due)/i,
  /\boverdue\b.*review/i,
  /reminder[:\s].*review/i,
  /review[:\s].*reminder/i,
  /your review (?:of|for|is due|.*) by\b/i,
];

const INVITATION_PATTERNS: RegExp[] = [
  /invitation to review/i,
  /invited to review/i,
  /would (?:you )?be willing to review/i,
  /agree to review/i,
  /심사[\s\S]{0,4}(?:요청|의뢰)/,
];

const REVIEW_RELATED = /\breview(?:er|ing)?\b|심사/i;

// Addendum A: forwarded editorial decision letters asking for a revision — these
// would otherwise match the "decision on your manuscript" negative pattern below,
// so revision is detected first and short-circuits the negative-class check.
const REVISION_PATTERNS: RegExp[] = [
  /major revision/i,
  /minor revision/i,
  /revise and resubmit/i,
  /revisions? (?:is |are )?required/i,
  /수정\s*후\s*재심/,
];

function isRevision(text: string): boolean {
  if (REVISION_PATTERNS.some((re) => re.test(text))) return true;
  // A bare "decision on your manuscript" is a plain accept/reject notice (stays
  // null); paired with revise/revision wording anywhere in the mail, it's a
  // revision letter.
  return /decision (?:on|regarding|has been made) your manuscript/i.test(text) && /revis(?:e|ion)/i.test(text);
}

function detectKind(text: string): ReviewMailKind | null {
  if (isRevision(text)) return 'revision';
  if (COMPLETED_PATTERNS.some((re) => re.test(text))) return 'completed';
  if (NEGATIVE_PATTERNS.some((re) => re.test(text))) return null;
  // Confirmation and invitation phrases are checked before reminder: a fresh
  // invitation email often also states its due date ("...is due by <date>"),
  // which would otherwise false-match the generic reminder phrasing below.
  if (CONFIRMATION_PATTERNS.some((re) => re.test(text))) return 'confirmation';
  if (INVITATION_PATTERNS.some((re) => re.test(text))) return 'invitation';
  if (REMINDER_PATTERNS.some((re) => re.test(text))) return 'reminder';
  if (REVIEW_RELATED.test(text)) return 'other';
  return null;
}

function extractRevisionType(text: string): 'major' | 'minor' | null {
  if (/major revision/i.test(text)) return 'major';
  if (/minor revision/i.test(text)) return 'minor';
  if (/revise and resubmit/i.test(text)) return 'major'; // R&R conventionally treated as major
  return null; // ambiguous (e.g. 수정 후 재심 alone) — accept flow defaults to 'major'
}

// --- manuscript id ---------------------------------------------------------

// ScholarOne-style: 'ABC-2026-1234' or 'ABC-D-26-00123'.
const SCHOLARONE_RE = /\b[A-Z]{2,8}-(?:[A-Z]-)?\d{2,4}-\d{3,6}\b/;
const JMIR_RE = /\bJMIR\s*#\s*(\d{3,8})\b/i;
const MDPI_RE = /\bmanuscripts-(\d{3,8})\b/i;

function extractManuscriptId(text: string): string | null {
  const scholarOne = SCHOLARONE_RE.exec(text);
  if (scholarOne) return scholarOne[0];
  const jmir = JMIR_RE.exec(text);
  if (jmir) return `JMIR-${jmir[1]}`;
  const mdpi = MDPI_RE.exec(text);
  if (mdpi) return `manuscripts-${mdpi[1]}`;
  return null;
}

// --- journal -----------------------------------------------------------

const BRACKET_BLOCKLIST = /^(reminder|action required|urgent|external|fwd|re|automated message)$/i;

function trimJournal(s: string): string {
  return s.replace(/[.,;:\s]+$/, '').trim();
}

function extractJournal(subject: string, body: string, from: string): string | null {
  const bracket = /\[([^\]]{3,80})\]/.exec(subject);
  if (bracket && !BRACKET_BLOCKLIST.test(bracket[1].trim())) return trimJournal(bracket[1]);

  const forJournal = /\bfor (?:the )?([A-Z][A-Za-z0-9&,.' -]{2,70}?)(?=[.,:\n]|$)/.exec(`${subject}\n${body}`);
  if (forJournal) return trimJournal(forJournal[1]);

  const editorOf = /\bEditor of (?:the )?([A-Z][A-Za-z0-9&,.' -]{2,70}?)(?=[.,:\n]|$)/.exec(body);
  if (editorOf) return trimJournal(editorOf[1]);

  const onBehalfOf = /\bon behalf of (?:the )?([A-Z][A-Za-z0-9&,.' -]{2,70}?)(?=[.,:\n]|$)/i.exec(body);
  if (onBehalfOf) return trimJournal(onBehalfOf[1]);

  const display = /^"?([^"<]{3,80}?)"?\s*<[^>]+>$/.exec(from.trim());
  if (display && /journal|review|editor/i.test(display[1])) return trimJournal(display[1]);

  return null;
}

// --- title ---------------------------------------------------------------

function extractTitle(body: string): string | null {
  const quoted = /"([^"]{5,200})"/.exec(body);
  if (quoted) return quoted[1].trim();
  const entitled = /\b(?:entitled|titled)\s+"?([^".\n]{5,200}?)"?(?=[.,\n]|$)/i.exec(body);
  if (entitled) return entitled[1].trim();
  return null;
}

// --- due date --------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function monthNum(name: string): number | null {
  const key = name.slice(0, 3).toLowerCase();
  return MONTHS[key] ?? null;
}

/** Tries every supported absolute-date format at the start of `s`; returns 'YYYY-MM-DD' or null. */
function matchAbsoluteDate(s: string): string | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(s);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;

  m = /^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})/.exec(s);
  if (m) {
    const mo = monthNum(m[2]);
    if (mo) return `${m[3]}-${pad(mo)}-${pad(Number(m[1]))}`;
  }

  m = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m) {
    const mo = monthNum(m[1]);
    if (mo) return `${m[3]}-${pad(mo)}-${pad(Number(m[2]))}`;
  }

  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/.exec(s);
  if (m) {
    const mo = monthNum(m[2]);
    if (mo) return `${m[3]}-${pad(mo)}-${pad(Number(m[1]))}`;
  }

  // US order month/day/year.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;

  return null;
}

const LANDMARK_RE = /\b(due|deadline|by|within|in)\b/gi;
// The landmark keyword itself (e.g. "within"/"in") is already consumed by LANDMARK_RE,
// so this only needs to match the day count that follows it directly.
const RELATIVE_RE = /^\s*(\d{1,3})\s+days?\b/i;
const WINDOW = 160;

function extractDueDate(body: string, receivedAt: string): string | null {
  const receivedDate = receivedAt.slice(0, 10);
  for (const landmark of body.matchAll(LANDMARK_RE)) {
    const rest = body.slice(landmark.index + landmark[0].length, landmark.index + landmark[0].length + WINDOW);
    const relative = RELATIVE_RE.exec(rest);
    if (relative) return addDaysStr(receivedDate, Number(relative[1]));
    // Absolute dates can appear a few words after the landmark ("due on 15 October 2026"),
    // so scan a short sliding window rather than requiring an exact match at position 0.
    for (let offset = 0; offset < rest.length; offset += 1) {
      const found = matchAbsoluteDate(rest.slice(offset));
      if (found) return found;
    }
  }
  return null;
}

// --- link ------------------------------------------------------------------

const URL_RE = /https:\/\/[^\s<>"')]+/gi;
const LINK_KEYWORDS = /reviewer|review|manuscript|assignment/i;

function extractLink(body: string): string | null {
  for (const m of body.matchAll(URL_RE)) {
    if (LINK_KEYWORDS.test(m[0])) return m[0];
  }
  return null;
}

// The owner doesn't review for MDPI, so its reviewer mail is dropped by sender
// domain. Revision letters on the owner's own MDPI papers are still kept.
const IGNORED_REVIEW_SENDER = /@(?:[\w-]+\.)*mdpi\.com>?\s*$/i;
// Author-services marketing (editing/translation vendors) talks about "심사 의견"/
// "reviewer comments" constantly but is never a review assignment.
const MARKETING_SENDER = /@(?:[\w-]+\.)*(?:editage|enago|aje|wordvice|cactusglobal)\.[a-z.]+>?\s*$/i;

/** Parses one Gmail message; returns null when it isn't an actual review assignment
 * (calls for reviewers, submit/contribute solicitations, issue alerts, the user's
 * own manuscript acknowledgements/decisions, and anything not review-related). */
export function parseReviewMail(input: ReviewMailInput): ParsedReviewMail | null {
  const text = `${input.subject}\n${input.body}`;
  const kind = detectKind(text);
  if (!kind) return null;
  const from = input.from.trim();
  if (MARKETING_SENDER.test(from)) return null;
  if (kind !== 'revision' && IGNORED_REVIEW_SENDER.test(from)) return null;
  const manuscriptId = extractManuscriptId(text);
  // A vague "review"-mentioning mail is only worth a candidate when it names a manuscript.
  if (kind === 'other' && !manuscriptId) return null;

  return {
    kind,
    manuscriptId,
    journal: extractJournal(input.subject, input.body, input.from),
    title: extractTitle(input.body),
    dueDate: extractDueDate(input.body, input.receivedAt),
    link: extractLink(input.body),
    revisionType: kind === 'revision' ? extractRevisionType(text) : null,
  };
}
