import { describe, expect, it } from 'vitest';
import { quickLinks } from './quick-links';
import type { Project } from '@/lib/types';

const project = (over: Partial<Project>): Project => ({ id: 'p', name: 'P', status: 'active', sort: 0, links: [], ...over }) as Project;

describe('quickLinks', () => {
  it('keeps openable dashboards, drops repos/folders/non-http, flags local as PC-only', () => {
    const links = quickLinks([
      project({
        id: 'a',
        name: 'Fictional Map (fic-map)',
        sort: 1,
        links: [
          { label: '서비스', url: 'https://fic.example', kind: 'public' },
          { label: '운영', url: 'http://127.0.0.1:4777', kind: 'local' },
          { label: 'GitHub', url: 'https://github.com/x/y', kind: 'repo' },
          { label: 'launcher', url: 'tools/launch.bat', kind: 'local' },
        ],
      }),
      project({ id: 'b', name: 'Old', status: 'archived', links: [{ label: 'x', url: 'https://old.example', kind: 'public' }] }),
      project({ id: 'c', name: 'Notes', sort: 0, status: 'done', links: [{ label: '캘린더', url: 'http://localhost:3010/calendar', kind: 'local' }] }),
    ]);
    expect(links).toEqual([
      { label: '캘린더', url: 'http://localhost:3010/calendar', projectName: 'Notes', pcOnly: true },
      { label: '서비스', url: 'https://fic.example', projectName: 'Fictional Map', pcOnly: false },
      { label: '운영', url: 'http://127.0.0.1:4777', projectName: 'Fictional Map', pcOnly: true },
    ]);
  });
});
