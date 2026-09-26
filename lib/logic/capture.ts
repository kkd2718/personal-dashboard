import type { NoteKind, Project } from '@/lib/types';

export interface ParsedCapture {
  body: string; // unchanged from input — never lose what the user typed
  projectId: string | null;
  tags: string[]; // as entered, deduped case-insensitively
  kind: NoteKind;
}

const TAG_RE = /#([\p{L}\p{N}_-]+)/gu;
const MENTION_RE = /@([\p{L}\p{N}_-]+)/gu;
const URL_RE = /^https?:\/\/\S+$/i;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_-]/g, '');
}

/** First project whose slug, name, or an alias (normalized) starts with/contains the token. */
function matchProject(token: string, projects: Project[]): Project | null {
  const norm = normalize(token);
  if (!norm) return null;
  return (
    projects.find((p) => {
      const candidates = [p.slug, p.name, ...p.aliases].map(normalize);
      return candidates.some((c) => c.length > 0 && (c.startsWith(norm) || norm.startsWith(c)));
    }) ?? null
  );
}

/**
 * Tags as typed, deduped case-insensitively. When `existingTags` has a tag whose
 * normalized form (lowercase, no spaces/_/-) matches, the existing tag's casing/
 * spelling is reused instead of the freshly typed one (so '연구 아이디어' and
 * '연구아이디어' resolve to the same tag).
 */
function extractTags(text: string, existingTags: string[] = []): string[] {
  const existingByNorm = new Map(existingTags.map((t) => [normalize(t), t]));
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const raw = m[1];
    const resolved = existingByNorm.get(normalize(raw)) ?? raw;
    const key = resolved.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(resolved);
    }
  }
  return tags;
}

function extractProjectId(text: string, projects: Project[]): string | null {
  for (const m of text.matchAll(MENTION_RE)) {
    const project = matchProject(m[1], projects);
    if (project) return project.id;
  }
  return null;
}

function detectKind(text: string): NoteKind {
  const trimmed = text.trim();
  if (trimmed.startsWith('!') || trimmed.startsWith('아이디어:')) return 'idea';
  if (trimmed.startsWith('[ ]')) return 'todo';
  const stripped = trimmed.replace(TAG_RE, '').replace(MENTION_RE, '').trim();
  if (URL_RE.test(stripped)) return 'link';
  return 'memo';
}

/**
 * Parses a quick-capture line into body/project/tags/kind.
 * `body` is always the original text, untouched — tags/mentions stay in it.
 * `existingTags` lets already-used tags absorb near-duplicates (see extractTags).
 */
export function parseCapture(text: string, projects: Project[], existingTags: string[] = []): ParsedCapture {
  return {
    body: text,
    projectId: extractProjectId(text, projects),
    tags: extractTags(text, existingTags),
    kind: detectKind(text),
  };
}

export { normalize };
