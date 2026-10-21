import { describe, expect, it } from 'vitest';
import { FORBIDDEN_KEY, flippedToFail, isStale, mdLabel, parseBrief, shouldRotate, stripForbiddenKeys } from './market-brief';
import { brief, rawBody } from './market-brief.fixtures';

describe('parseBrief (allow-list)', () => {
  it('keeps allow-listed fields and drops regime, accounts, rsi snipers and series', () => {
    const body = parseBrief(rawBody())!;
    expect(body.as_of).toBe('2026-11-06');
    expect(body.macro?.fear_greed).toEqual({ score: 54, zone_label: 'Neutral' });
    expect(body.macro?.usdkrw).toEqual({ current: 1391.2, change_pct: 0.3 }); // `series` stripped
    const json = JSON.stringify(body);
    for (const leaked of ['"regime":', 'allocation', 'ACCT-SECRET', 'total_value', 'ib_sniper', 'vr_sniper', 'accounts']) {
      expect(json).not.toContain(leaked);
    }
    expect(Object.keys(body).sort()).toEqual(['as_of', 'econ', 'macro', 'sectors', 'strategy', 'trades', 'upcoming']);
  });

  it('as_of is required', () => {
    expect(parseBrief(rawBody({ as_of: undefined }))).toBeNull();
    expect(parseBrief('nope')).toBeNull();
  });

  it('a wrongly typed leaf is dropped, not fatal', () => {
    const body = parseBrief(rawBody({ macro: { vix: { value: 'high', zone_label: 5 }, fear_greed: { score: 40 } } }))!;
    expect(body.macro?.vix).toEqual({});
    expect(body.macro?.fear_greed?.score).toBe(40);
  });

  it('an invalid trades block is dropped; an unknown check status becomes warn', () => {
    expect(parseBrief(rawBody({ trades: { overall: 'fine', checks: [] } }))!.trades).toBeUndefined();
    const body = parseBrief(rawBody({ trades: { overall: 'warn', checks: [{ id: 'a', label: 'A', status: 'weird' }] } }))!;
    expect(body.trades?.checks[0].status).toBe('warn');
  });

  it('long strings are rejected per item (field dropped), arrays are capped', () => {
    const body = parseBrief(rawBody({ strategy: [{ id: 's', label: 'L', state: 'ON', detail: 'x'.repeat(500) }] }))!;
    expect(body.strategy[0].detail).toBeUndefined();
    expect(parseBrief(rawBody({ sectors: Array.from({ length: 31 }, () => ({ ticker: 'X' })) }))!.sectors).toEqual([]);
  });
});

describe('stripForbiddenKeys', () => {
  it('drops keys matching the forbidden pattern anywhere, keeps the rest', () => {
    const out = stripForbiddenKeys({
      ok: 1,
      list: [{ amount_krw: 5, fine: true }],
      nested: { Account_Id: 'a', pnl_pct: 3, 평가금액: 9, keep: { 수량: 1, holdings: [], x: 2 } },
      weight: 1,
      qty: 2,
      balance: 3,
      value_krw: 4,
      quantity: 5,
    });
    expect(out).toEqual({ ok: 1, list: [{ fine: true }], nested: { keep: { x: 2 } } });
  });
  it('does not touch benign keys', () => {
    for (const k of ['value', 'dist_200d_pct', 'netliq_chg13w_pct', 'quadrant', 'composite']) expect(FORBIDDEN_KEY.test(k)).toBe(false);
  });
});

describe('snapshot helpers', () => {
  it('flippedToFail only on a new failure', () => {
    const ok = { trades: { overall: 'ok' as const, checks: [] } };
    const fail = { trades: { overall: 'fail' as const, checks: [] } };
    expect(flippedToFail(ok, fail)).toBe(true);
    expect(flippedToFail(null, fail)).toBe(true);
    expect(flippedToFail(fail, fail)).toBe(false);
    expect(flippedToFail(fail, ok)).toBe(false);
    expect(flippedToFail(ok, { trades: undefined })).toBe(false);
  });
  it('isStale after 36 hours', () => {
    expect(isStale({ receivedAt: '2026-11-06T00:00:00.000Z' }, '2026-11-07T11:59:00.000Z')).toBe(false);
    expect(isStale({ receivedAt: '2026-11-06T00:00:00.000Z' }, '2026-11-07T12:01:00.000Z')).toBe(true);
    expect(isStale({ receivedAt: 'garbage' }, '2026-11-07T00:00:00.000Z')).toBe(true);
  });
  it('shouldRotate compares KST days', () => {
    // 2026-11-06T16:00Z is already 11-07 01:00 KST
    expect(shouldRotate({ receivedAt: '2026-11-06T10:00:00.000Z' }, '2026-11-06T16:00:00.000Z')).toBe(true);
    expect(shouldRotate({ receivedAt: '2026-11-06T16:30:00.000Z' }, '2026-11-07T10:00:00.000Z')).toBe(false);
    expect(shouldRotate(null, '2026-11-07T10:00:00.000Z')).toBe(false);
  });
  it('mdLabel is KST', () => {
    expect(mdLabel('2026-11-06T16:00:00.000Z')).toBe('11/7');
    expect(brief().source).toBe('vm');
  });
});

describe('accounts section (allow-list vs forbidden keys)', () => {
  const accounts = {
    collected_at: '2026-11-07T00:00:00.000Z',
    total_krw: 123_456_789,
    day_change_krw: -1000,
    day_change_pct: -0.1,
    fx_rate: 1330,
    points: [{ date: '2026-11-06', total_krw: 120_000_000 }],
    items: [
      { id: 'ibvr', label: 'IB+VR', group: null, currency: 'USD', total_value: 41234, cum_return_pct: 12.3, since_baseline_pct: null, baseline_date: null, reserve_usd: 18800, status: 'ok', last_run: '2026-11-06', next_due: '2026-11-13', account_no: '123-456', holdings: [{ qty: 3 }] },
    ],
  };

  it('keeps `accounts` and its item ids but drops account_no/holdings/unknown keys', () => {
    const body = parseBrief(rawBody({ accounts }))!;
    expect(body.accounts?.total_krw).toBe(123_456_789);
    expect(body.accounts?.items[0]).toMatchObject({ id: 'ibvr', label: 'IB+VR', total_value: 41234, reserve_usd: 18800 });
    const json = JSON.stringify(body);
    for (const leaked of ['account_no', '123-456', 'holdings', 'qty', 'ACCT-SECRET']) expect(json).not.toContain(leaked);
  });

  it('forbidden pattern is unchanged; only the exact key `accounts` is exempted in stripForbiddenKeys', () => {
    for (const k of ['account', 'accounts', 'account_id', 'account_no', 'accountNumber', 'Account_Id', 'account_balances']) expect(FORBIDDEN_KEY.test(k)).toBe(true);
    for (const k of ['total_krw', 'total_value', 'reserve_usd', 'since_baseline_pct', 'items']) expect(FORBIDDEN_KEY.test(k)).toBe(false);
    expect(stripForbiddenKeys({ accounts: { items: [{ id: 'a', account_id: 'x' }] }, accountsList: 1, account_balances: [] })).toEqual({ accounts: { items: [{ id: 'a' }] } });
  });

  it('one bad item or point is dropped on its own; the rest of the list survives', () => {
    const body = parseBrief(rawBody({ accounts: { total_krw: 1, points: [{ date: 'd', total_krw: 'x' }, { date: 'e', total_krw: 2 }], items: [{ label: 'no id' }, { id: 'ok', label: 'OK' }] } }))!;
    expect(body.accounts?.items.map((i) => i.id)).toEqual(['ok']);
    expect(body.accounts?.points).toEqual([{ date: 'e', total_krw: 2 }]);
  });

  it('collected_at without a UTC offset is dropped (it would be read as UTC)', () => {
    expect(parseBrief(rawBody({ accounts: { total_krw: 1, collected_at: '2026-11-07T09:00:00' } }))!.accounts?.collected_at).toBeUndefined();
    expect(parseBrief(rawBody({ accounts: { total_krw: 1, collected_at: '2026-11-07T09:00:00+09:00' } }))!.accounts?.collected_at).toBe('2026-11-07T09:00:00+09:00');
  });

  it('a malformed accounts section is dropped without failing the push', () => {
    const body = parseBrief(rawBody({ accounts: [{ label: 'x' }] }))!;
    expect(body.accounts).toBeUndefined();
    expect(body.as_of).toBe('2026-11-06');
  });
});
