import type { Project } from '@/lib/types';

export interface QuickLink {
  label: string;
  url: string;
  projectName: string;
  pcOnly: boolean; // 'local' links (127.0.0.1/localhost) only open on the PC itself
}

/** Openable dashboards across projects (sidebar 바로가기 + 프로젝트 page chips):
 * public/tailscale/local http(s) links of non-archived projects, in project order.
 * Repos and folders are excluded — they aren't dashboards. */
export function quickLinks(projects: Project[]): QuickLink[] {
  return [...projects]
    .filter((p) => p.status !== 'archived')
    .sort((a, b) => a.sort - b.sort)
    .flatMap((p) =>
      p.links
        .filter((l) => (l.kind === 'public' || l.kind === 'tailscale' || l.kind === 'local') && /^https?:\/\//.test(l.url))
        .map((l) => ({ label: l.label, url: l.url, projectName: shortName(p.name), pcOnly: l.kind === 'local' }))
    );
}

/** '동네시세 (realty-chart)' -> '동네시세' — the parenthesised repo name is noise in a link list. */
function shortName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, '').trim() || name;
}
