// Per-request memoized reads so the (main) layout and the home page share one query each.
// Server components only — never import from a client component. Server actions keep
// calling getRepo() directly, so the re-render after a write starts with an empty cache.
import { cache } from 'react';
import { getRepo } from '@/lib/repo';

export const cachedProjects = cache(() => getRepo().listProjects());
export const cachedNotes = cache(() => getRepo().listNotes());
export const cachedPapers = cache(() => getRepo().listPapers());
export const cachedReviews = cache(() => getRepo().listReviews());
