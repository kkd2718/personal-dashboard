// Flip-to-fail alert for the market snapshot's trade checks. False (not sent) keeps the flip pending.
import type { BriefBody } from '@/lib/logic/market-brief';
import { sendMessage, telegramConfig } from '@/lib/telegram/client';
import { formatTradesFailAlert } from '@/lib/telegram/format';

export async function notifyTradesFail(trades: NonNullable<BriefBody['trades']>): Promise<boolean> {
  if (!telegramConfig()) return false;
  return (await sendMessage(formatTradesFailAlert(trades))).ok;
}
