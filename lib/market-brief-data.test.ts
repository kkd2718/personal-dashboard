import { describe, expect, it } from 'vitest';
import { fakeRepo } from '@/lib/ask/fixtures';
import { parseBrief } from '@/lib/logic/market-brief';
import { rawBody } from '@/lib/logic/market-brief.fixtures';
import { loadBriefs, storeBrief } from './market-brief-data';

const body = (over: Record<string, unknown> = {}) => parseBrief(rawBody(over))!;
const failing = { trades: { overall: 'fail', checks: [{ id: 'fill', label: '체결', status: 'fail', detail: '2건 실패' }] } };

const DAY1 = '2026-11-07T00:00:00.000Z'; // 09:00 KST 11/7
const DAY1_LATER = '2026-11-07T09:00:00.000Z';
const DAY2 = '2026-11-08T00:00:00.000Z';

describe('storeBrief', () => {
  it('stores with receivedAt and source', async () => {
    const { repo, meta } = fakeRepo();
    const r = await storeBrief(repo, body(), 'vm', DAY1);
    expect(r).toEqual({ stored: true, flippedToFail: false, alerted: false });
    expect(meta.get('trading:market')).toMatchObject({ as_of: '2026-11-06', receivedAt: DAY1, source: 'vm' });
    expect(meta.has('trading:market:prev')).toBe(false);
  });

  it('rotates the replaced snapshot into prev once per KST day', async () => {
    const { repo, meta } = fakeRepo();
    await storeBrief(repo, body({ as_of: 'a' }), 'vm', DAY1);
    await storeBrief(repo, body({ as_of: 'b' }), 'vm', DAY1_LATER); // same day: no rotation
    expect(meta.has('trading:market:prev')).toBe(false);
    await storeBrief(repo, body({ as_of: 'c' }), 'vm', DAY2); // next day: 'b' becomes prev
    expect(meta.get('trading:market:prev')).toMatchObject({ as_of: 'b' });
    await storeBrief(repo, body({ as_of: 'd' }), 'vm', '2026-11-08T05:00:00.000Z'); // same day again: prev untouched
    expect(meta.get('trading:market:prev')).toMatchObject({ as_of: 'b' });
    expect((await loadBriefs(repo)).current).toMatchObject({ as_of: 'd' });
  });

  it('re-pushing the same as_of overwrites (idempotent)', async () => {
    const { repo, meta } = fakeRepo();
    await storeBrief(repo, body(), 'vm', DAY1);
    await storeBrief(repo, body(), 'vm', DAY1_LATER);
    expect(meta.get('trading:market')).toMatchObject({ receivedAt: DAY1_LATER });
  });

  it('flip to fail is reported once, not on repeats', async () => {
    const { repo } = fakeRepo();
    await storeBrief(repo, body(), 'vm', DAY1);
    expect((await storeBrief(repo, body(failing), 'vm', DAY1_LATER)).flippedToFail).toBe(true);
    expect((await storeBrief(repo, body(failing), 'vm', '2026-11-07T10:00:00.000Z')).flippedToFail).toBe(false);
  });

  describe('PC fallback precedence', () => {
    it('writes when nothing is stored', async () => {
      const { repo, meta } = fakeRepo();
      expect((await storeBrief(repo, body(), 'pc', DAY1)).stored).toBe(true);
      expect(meta.get('trading:market')).toMatchObject({ source: 'pc' });
    });
    it('does not overwrite a VM snapshot younger than 6 h', async () => {
      const { repo, meta } = fakeRepo();
      await storeBrief(repo, body({ as_of: 'vm' }), 'vm', DAY1);
      const r = await storeBrief(repo, body({ as_of: 'pc' }), 'pc', '2026-11-07T05:59:00.000Z');
      expect(r.stored).toBe(false);
      expect(meta.get('trading:market')).toMatchObject({ as_of: 'vm', source: 'vm' });
    });
    it('overwrites once the stored snapshot is 6 h old, and the VM always wins afterwards', async () => {
      const { repo, meta } = fakeRepo();
      await storeBrief(repo, body({ as_of: 'vm' }), 'vm', DAY1);
      expect((await storeBrief(repo, body({ as_of: 'pc' }), 'pc', '2026-11-07T06:01:00.000Z')).stored).toBe(true);
      expect(meta.get('trading:market')).toMatchObject({ as_of: 'pc', source: 'pc' });
      await storeBrief(repo, body({ as_of: 'vm2' }), 'vm', '2026-11-07T06:02:00.000Z');
      expect(meta.get('trading:market')).toMatchObject({ as_of: 'vm2', source: 'vm' });
    });
  });
});

describe('storeBrief with an accounts section', () => {
  const accounts = (collected_at: string, total_krw = 1000) => ({ collected_at, total_krw, items: [{ id: 'a', label: 'A', total_value: 1 }] });

  it('writes trading:summary (VM) and keeps accounts out of trading:market', async () => {
    const { repo, meta } = fakeRepo();
    await storeBrief(repo, body({ accounts: accounts(DAY1) }), 'vm', DAY1);
    expect(meta.get('trading:summary')).toMatchObject({ collectedAt: DAY1, totalKrw: 1000, accounts: [{ id: 'a', totalValue: 1 }] });
    expect(JSON.stringify(meta.get('trading:market'))).not.toContain('accounts');
  });

  it('an older VM summary never replaces a newer stored one; a newer one does', async () => {
    const { repo, meta } = fakeRepo({ meta: { 'trading:summary': { collectedAt: DAY1_LATER, totalKrw: 5, accounts: [] } } });
    await storeBrief(repo, body({ accounts: accounts(DAY1) }), 'vm', DAY1_LATER);
    expect(meta.get('trading:summary')).toMatchObject({ totalKrw: 5 });
    await storeBrief(repo, body({ accounts: accounts('2026-11-07T10:00:00.000Z', 9) }), 'vm', '2026-11-07T10:00:00.000Z');
    expect(meta.get('trading:summary')).toMatchObject({ totalKrw: 9 });
  });

  it('PC accounts only land over a missing or > 6 h old summary, independent of the market snapshot', async () => {
    const fresh = fakeRepo({ meta: { 'trading:summary': { collectedAt: '2026-11-07T08:00:00.000Z', source: 'vm', totalKrw: 5, accounts: [] } } });
    await storeBrief(fresh.repo, body({ accounts: accounts(DAY1_LATER, 7) }), 'pc', DAY1_LATER);
    expect(fresh.meta.get('trading:summary')).toMatchObject({ totalKrw: 5 });
    const old = fakeRepo({ meta: { 'trading:summary': { collectedAt: DAY1, source: 'vm', totalKrw: 5, accounts: [] } } });
    await storeBrief(old.repo, body({ accounts: accounts(DAY1_LATER, 7) }), 'pc', DAY1_LATER);
    expect(old.meta.get('trading:summary')).toMatchObject({ totalKrw: 7, source: 'pc' });
  });

  it('the hourly PC refresh is not blocked by a PC-written summary', async () => {
    const { repo, meta } = fakeRepo({ meta: { 'trading:summary': { collectedAt: DAY1, source: 'pc', totalKrw: 5, accounts: [] } } });
    await storeBrief(repo, body({ accounts: accounts('2026-11-07T01:00:00.000Z', 8) }), 'pc', '2026-11-07T01:00:00.000Z');
    expect(meta.get('trading:summary')).toMatchObject({ totalKrw: 8, source: 'pc' });
  });

  it('a push whose items all failed validation never wipes stored accounts', async () => {
    const stored = { collectedAt: DAY1, source: 'vm', totalKrw: 5, accounts: [{ id: 'a' }] };
    const { repo, meta } = fakeRepo({ meta: { 'trading:summary': stored } });
    await storeBrief(repo, body({ accounts: { collected_at: DAY1_LATER, total_krw: 9, items: [{ nope: 1 }] } }), 'vm', DAY1_LATER);
    expect(meta.get('trading:summary')).toEqual(stored);
  });
});
