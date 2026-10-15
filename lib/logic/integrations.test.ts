import { describe, expect, it } from 'vitest';
import { googleAccountsFromMeta, integrationRowInfo, staleGoogleAccounts } from './integrations';

const NOW = '2026-09-26T12:00:00.000Z';

describe('integrationRowInfo', () => {
  it('renders "설정되지 않음" with unknown health when meta is null', () => {
    expect(integrationRowInfo('collector', null, NOW)).toEqual({
      health: 'unknown',
      sentence: '설정되지 않음',
    });
  });

  it('is ok within the threshold and includes the detail fragment', () => {
    const meta = { at: '2026-09-26T11:00:00.000Z', detail: '6개 프로젝트' };
    const info = integrationRowInfo('collector', meta, NOW);
    expect(info.health).toBe('ok');
    expect(info.sentence).toBe('마지막 수신 1시간 전 · 6개 프로젝트');
  });

  it('is stale past the threshold (collector/google/obsidian: 3h)', () => {
    const meta = { at: '2026-09-26T08:00:00.000Z' };
    const info = integrationRowInfo('google', meta, NOW);
    expect(info.health).toBe('stale');
    expect(info.sentence).toBe('마지막 수신 4시간 전');
  });

  it('telegram has no staleness threshold — any known activity reads ok', () => {
    const meta = { at: '2026-09-20T00:00:00.000Z' };
    expect(integrationRowInfo('telegram', meta, NOW).health).toBe('ok');
  });
});

describe('googleAccountsFromMeta', () => {
  it('strips the integration:google: prefix to get the account name', () => {
    const meta = {
      'integration:google:main': { at: NOW, detail: '캘린더 3개' },
      'integration:google:amc': { at: NOW },
    };
    expect(googleAccountsFromMeta(meta)).toEqual({
      main: { at: NOW, detail: '캘린더 3개' },
      amc: { at: NOW },
    });
  });
});

describe('staleGoogleAccounts', () => {
  const now = '2026-10-15T08:00:00.000Z';
  it('lists accounts silent for more than 6h, oldest first', () => {
    const meta = {
      'integration:google:amc': { at: '2026-10-15T07:40:00.000Z' },
      'integration:google:main': { at: '2026-10-05T05:34:00.000Z' },
      'integration:google:old': { at: '2026-10-15T01:00:00.000Z' },
    };
    const out = staleGoogleAccounts(meta, now);
    expect(out.map((s) => s.split(' ')[0])).toEqual(['main', 'old']);
  });
  it('empty when all fresh', () => {
    expect(staleGoogleAccounts({ 'integration:google:main': { at: '2026-10-15T07:00:00.000Z' } }, now)).toEqual([]);
  });
});
