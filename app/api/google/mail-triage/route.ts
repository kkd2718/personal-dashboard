import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkBearer } from '@/lib/auth/bearer';
import { createJev, jevToken } from '@/lib/ai/jev';
import { jevMailLimit, takeJevBudget } from '@/lib/ai/jev-budget';
import {
  ATTENTION_QUESTION,
  MAIL_CAP_NOTICE_KEY,
  MAIL_TRIAGE_CONFIG_KEY,
  TRIAGE_THRESHOLD,
  crossAccountKey,
  isRetryableSendFailure,
  mailAlertedKey,
  mailSeenKey,
  normalizeTriageConfig,
  rememberSeen,
  stripAttachmentNames,
  triageDecision,
  triageState,
  unseen,
  type TriageMail,
} from '@/lib/logic/mail-triage';
import { addDaysStr, todayKST } from '@/lib/logic/dates';
import { getRepo } from '@/lib/repo';
import { sendMessage, telegramConfig } from '@/lib/telegram/client';
import { MAIL_CAP_NOTICE, formatMailAlert } from '@/lib/telegram/format';
import { createAskClient } from '@/lib/ask/client';
import { sendMailAlert, summarizeMail, type MailAlertDeps } from '@/lib/telegram/mail-actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BYTES = 256 * 1024;

// `.strict()`: an unexpected key (e.g. `attachments`) is a 400, never silently accepted.
const messageSchema = z
  .object({
    messageId: z.string().min(1),
    threadId: z.string().min(1),
    from: z.string().max(300),
    subject: z.string().max(500),
    receivedAt: z.string().min(1),
    link: z.string().startsWith('https://mail.google.com/'),
    snippet: z.string().max(300).optional(),
  })
  .strict();

const bodySchema = z.object({
  account: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9._@-]+$/),
  messages: z.array(messageSchema).max(50),
});

/** For the 5-minute `triage` trigger of integrations/google/Code.gs (one per account). Mail
 * content only travels to Telegram/Jev; only message ids and counters are stored. */
export async function POST(request: Request) {
  const auth = checkBearer(request, process.env.GOOGLE_SYNC_TOKEN);
  if (auth === 'missing-config') {
    return NextResponse.json({ ok: false, error: 'GOOGLE_SYNC_TOKEN not configured' }, { status: 503 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf-8') > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'payload too large' }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }

  const { account, messages } = parsed.data;
  const repo = getRepo();
  const today = todayKST();
  const cfg = normalizeTriageConfig(await repo.getMeta(MAIL_TRIAGE_CONFIG_KEY));
  const noBody = cfg.noBodyAccounts.includes(account);

  // The snippet is filtered again here whatever the script did; a kill-switched account sends none.
  const mails: TriageMail[] = messages.map(({ snippet, ...m }) => {
    const clean = !noBody && snippet ? stripAttachmentNames(snippet) : '';
    return clean ? { ...m, snippet: clean } : m;
  });

  const seen = (await repo.getMeta<string[]>(mailSeenKey(account))) ?? [];
  const fresh = unseen(mails, seen);
  const alerted = new Set((await repo.getMeta<string[]>(mailAlertedKey(today))) ?? []);
  const threshold = cfg.threshold ?? TRIAGE_THRESHOLD;
  const jev = createJev({ token: jevToken(process.env, request.headers) });

  const toAlert: TriageMail[] = [];
  const keys = new Set<string>();
  let capped = false;
  for (const m of fresh) {
    const key = crossAccountKey(m);
    if (alerted.has(key) || keys.has(key)) continue; // same letter already alerted today (either account)
    const decision = triageDecision(m, cfg);
    if (decision === 'deny') continue;
    if (decision === 'ask') {
      if (!jev) continue;
      if (!(await takeJevBudget(repo, 'mail', today, jevMailLimit()))) {
        capped = true;
        continue;
      }
      const attention = (await jev.ask(triageState(m), { attention: ATTENTION_QUESTION }))?.attention;
      if (attention?.type !== 'noul' || attention.p < threshold) continue;
    }
    keys.add(key);
    toAlert.push(m);
  }

  // Only a retryable Telegram failure (network, 429, 5xx) answers 502 and leaves the alerted mails
  // unrecorded so the script (which only advances on 200) resends them. A 4xx would repeat forever,
  // so that batch is marked seen and the error is reported on the integration row instead.
  let sendError: string | null = null;
  let sentKeys = keys;
  const client = createAskClient();
  if (toAlert.length > 0 && telegramConfig() && client) {
    // AI path: one message per mail (summary + buttons). Falls back to plain alerts on any AI failure.
    const nowIso = new Date().toISOString();
    const deps: MailAlertDeps = { repo, client, today, nowIso, send: (text, replyMarkup) => sendMessage(text, { replyMarkup }) };
    const projects = await repo.listProjects();
    const summaries: Array<string | null> = []; // sequential: each call read-modify-writes the spend ledger
    for (const m of toAlert) summaries.push(await summarizeMail(deps, { from: m.from, subject: m.subject, snippet: m.snippet ?? '' }));
    sentKeys = new Set<string>();
    let retry = false;
    for (const [i, m] of toAlert.entries()) {
      const sent = await sendMailAlert(
        deps,
        { header: formatMailAlert([m]), from: m.from, subject: m.subject, snippet: m.snippet ?? '', link: m.link },
        summaries[i],
        projects
      );
      if (sent.ok) {
        sentKeys.add(crossAccountKey(m));
        continue;
      }
      if (isRetryableSendFailure(sent)) {
        retry = true;
        break;
      }
      sendError = sent.error ?? 'telegram error';
    }
    if (retry) {
      const unsent = new Set(toAlert.filter((m) => !sentKeys.has(crossAccountKey(m))).map((m) => m.messageId));
      await repo.setMeta(mailSeenKey(account), rememberSeen(seen, fresh.filter((m) => !unsent.has(m.messageId)).map((m) => m.messageId)));
      if (sentKeys.size > 0) await repo.setMeta(mailAlertedKey(today), [...alerted, ...sentKeys]);
      return NextResponse.json({ ok: false, error: 'telegram send failed' }, { status: 502 });
    }
  } else if (toAlert.length > 0 && telegramConfig()) {
    const sent = await sendMessage(formatMailAlert(toAlert));
    if (!sent.ok) {
      if (isRetryableSendFailure(sent)) {
        const alertedIds = new Set(toAlert.map((m) => m.messageId));
        await repo.setMeta(
          mailSeenKey(account),
          rememberSeen(seen, fresh.filter((m) => !alertedIds.has(m.messageId)).map((m) => m.messageId))
        );
        return NextResponse.json({ ok: false, error: 'telegram send failed' }, { status: 502 });
      }
      sendError = sent.error ?? 'telegram error';
    }
  }
  await repo.setMeta(mailSeenKey(account), rememberSeen(seen, fresh.map((m) => m.messageId)));
  if (sentKeys.size > 0 && (!sendError || client)) {
    await repo.setMeta(mailAlertedKey(today), [...alerted, ...sentKeys]);
    await pruneAlerted(repo, today);
  }

  if (capped && telegramConfig() && (await repo.getMeta<string>(MAIL_CAP_NOTICE_KEY)) !== today) {
    if ((await sendMessage(MAIL_CAP_NOTICE)).ok) await repo.setMeta(MAIL_CAP_NOTICE_KEY, today);
  }

  const alertedCount = client ? sentKeys.size : sendError ? 0 : toAlert.length;
  await repo.setMeta(`integration:mail:${account}`, {
    at: new Date().toISOString(),
    detail: `처리 ${fresh.length} · 알림 ${alertedCount}${sendError ? ` · 오류 ${sendError}` : ''}`,
  });
  return NextResponse.json({
    ok: true,
    processed: fresh.length,
    alerted: alertedCount,
    ...(sendError ? { error: sendError } : {}),
  });
}

/** Drops per-day "already alerted" lists older than 7 days (best-effort). */
async function pruneAlerted(repo: ReturnType<typeof getRepo>, today: string) {
  try {
    const cutoff = addDaysStr(today, -7);
    for (const key of Object.keys(await repo.listMetaByPrefix(mailAlertedKey('')))) {
      if (key.slice(-10) < cutoff) await repo.deleteMeta(key);
    }
  } catch {
    // stale lists are harmless
  }
}
