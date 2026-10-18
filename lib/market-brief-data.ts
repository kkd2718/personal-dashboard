// Repo access for the market snapshot (app_meta `trading:market`, previous day in `trading:market:prev`).
import {
  MARKET_BRIEF_META_KEY,
  MARKET_BRIEF_PREV_META_KEY,
  PC_FALLBACK_AFTER_HOURS,
  flippedToFail,
  shouldRotate,
  type BriefBody,
  type MarketBrief,
} from '@/lib/logic/market-brief';
import type { Repo } from '@/lib/repo';

export type BriefRepo = Pick<Repo, 'getMeta' | 'setMeta'>;

export interface StoreResult {
  stored: boolean;
  /** Trade checks newly failing vs the snapshot just replaced (or whose earlier alert failed to send). */
  flippedToFail: boolean;
  /** The flip alert was sent. */
  alerted: boolean;
}

/** Stores `body` as the current snapshot. Rotates the replaced one into `prev` once per KST day. The PC
 * fallback (`source: 'pc'`) only writes when the stored snapshot is missing or older than 6 h. */
export async function storeBrief(
  repo: BriefRepo,
  body: BriefBody,
  source: 'vm' | 'pc',
  nowIso: string,
  /** Sends the flip-to-fail alert; false keeps it pending so the next failing push retries. */
  notify?: (trades: NonNullable<BriefBody['trades']>) => Promise<boolean>
): Promise<StoreResult> {
  const current = await repo.getMeta<MarketBrief>(MARKET_BRIEF_META_KEY);
  if (source === 'pc' && current && (Date.parse(nowIso) - Date.parse(current.receivedAt)) / 3_600_000 < PC_FALLBACK_AFTER_HOURS) {
    return { stored: false, flippedToFail: false, alerted: false };
  }
  if (current && shouldRotate(current, nowIso)) await repo.setMeta(MARKET_BRIEF_PREV_META_KEY, current);
  const flipped = flippedToFail(current, body);
  const alerted = flipped && body.trades && notify ? await notify(body.trades).catch(() => false) : false;
  await repo.setMeta(MARKET_BRIEF_META_KEY, {
    ...body,
    receivedAt: nowIso,
    source,
    ...(flipped && notify && !alerted ? { alertPending: true } : {}),
  } satisfies MarketBrief);
  return { stored: true, flippedToFail: flipped, alerted };
}

export async function loadBriefs(repo: Pick<Repo, 'getMeta'>): Promise<{ current: MarketBrief | null; prev: MarketBrief | null }> {
  const [current, prev] = await Promise.all([
    repo.getMeta<MarketBrief>(MARKET_BRIEF_META_KEY),
    repo.getMeta<MarketBrief>(MARKET_BRIEF_PREV_META_KEY),
  ]);
  return { current, prev };
}
