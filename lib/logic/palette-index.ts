import type { Paper, Project, ReviewJob } from '@/lib/types';
import type { PaletteEntry } from '@/lib/logic/palette';

const PAGE_ENTRIES: PaletteEntry[] = [
  { id: 'page:home', label: '홈', kind: 'page', href: '/' },
  { id: 'page:memo', label: '메모', kind: 'page', href: '/memo' },
  { id: 'page:projects', label: '프로젝트', kind: 'page', href: '/projects' },
  { id: 'page:papers', label: '논문', kind: 'page', href: '/papers' },
  { id: 'page:review', label: '리뷰', kind: 'page', href: '/papers?tab=review' },
  { id: 'page:calendar', label: '캘린더', kind: 'page', href: '/calendar' },
  { id: 'page:settings', label: '설정', kind: 'page', href: '/settings' },
];

/** Builds the ⌘K static index (§4.1 "이동" scope): pages + every project/paper/open
 * review. Server-side and pure so it can be unit tested without a Repo. */
export function buildPaletteIndex(projects: Project[], papers: Paper[], reviews: ReviewJob[]): PaletteEntry[] {
  const projectEntries: PaletteEntry[] = projects.map((p) => ({
    id: `project:${p.id}`,
    label: p.name,
    sublabel: p.subgroup ?? p.group,
    kind: 'project',
    href: `/projects/${p.slug}`,
    keywords: [p.slug, ...p.aliases],
  }));

  const paperEntries: PaletteEntry[] = papers.map((p) => ({
    id: `paper:${p.id}`,
    label: p.shortName,
    sublabel: p.title,
    kind: 'paper',
    href: '/papers',
    keywords: [p.title, p.journal ?? '', p.manuscriptId ?? ''],
  }));

  const openReviews = reviews.filter((r) => r.status === 'invited' || r.status === 'accepted');
  const reviewEntries: PaletteEntry[] = openReviews.map((r) => ({
    id: `review:${r.id}`,
    label: `${r.journal}${r.manuscriptId ? ` ${r.manuscriptId}` : ''}`,
    sublabel: r.title ?? undefined,
    kind: 'review',
    href: '/papers?tab=review',
    keywords: [r.manuscriptId ?? ''],
  }));

  return [...PAGE_ENTRIES, ...projectEntries, ...paperEntries, ...reviewEntries];
}
