/** ⌘K command palette (ux-advice.md §4.1). No search API — the whole index is
 * built server-side and passed to the client, then fuzzy-matched here. */

export type PaletteKind = 'page' | 'project' | 'paper' | 'review' | 'create' | 'action';

export interface PaletteEntry {
  id: string;
  label: string;
  sublabel?: string;
  kind: PaletteKind;
  href?: string; // navigate on select (이동)
  action?: 'theme' | 'refresh' | 'export' | 'logout'; // 동작 rows
  keywords?: string[]; // aliases, slug, manuscriptId, etc.
}

/** Subsequence fuzzy score: every query char must appear in order in `text`
 * (case-insensitive). Returns null on no match, else a score where lower is
 * better (tighter, earlier matches rank first) so callers can sort ascending. */
function fuzzyScore(query: string, text: string): number | null {
  if (query.length === 0) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  const exactIndex = t.indexOf(q);
  if (exactIndex >= 0) return exactIndex; // contiguous substring match wins, earlier is better

  let ti = 0;
  let first = -1;
  let last = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return null;
    if (first === -1) first = idx;
    last = idx;
    ti = idx + 1;
  }
  // Penalize scattered matches (large span) relative to a tight substring match.
  return 1000 + (last - first);
}

function bestEntryScore(query: string, entry: PaletteEntry): number | null {
  const fields = [entry.label, entry.sublabel, ...(entry.keywords ?? [])].filter(
    (f): f is string => Boolean(f)
  );
  let best: number | null = null;
  for (const field of fields) {
    const score = fuzzyScore(query, field);
    if (score !== null && (best === null || score < best)) best = score;
  }
  return best;
}

/** Filters + ranks entries by fuzzy match; empty query returns entries unranked
 * (caller's original order), capped at `limit`. */
export function filterPaletteEntries(entries: PaletteEntry[], query: string, limit = 8): PaletteEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return entries.slice(0, limit);

  return entries
    .map((entry) => ({ entry, score: bestEntryScore(trimmed, entry) }))
    .filter((x): x is { entry: PaletteEntry; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.entry);
}
