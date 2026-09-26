#!/usr/bin/env node
// Telegram bot setup (phase 2b). Plain JS, Node >=18. Confirms the bot token,
// discovers TELEGRAM_CHAT_ID (from the last private message sent to the bot),
// generates TELEGRAM_WEBHOOK_SECRET, registers the webhook + bot commands, and
// optionally pushes the three env vars to Vercel and sends a test message.
// Never echoes secret values — only status, @username, and the last 3 digits
// of the chat id are printed.
//
// Usage: node --env-file=.env.local --experimental-strip-types scripts/telegram-setup.mjs [--vercel] [--send-test]
import { randomBytes } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './lib/env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, '.env.local');

const args = process.argv.slice(2);
const pushToVercel = args.includes('--vercel');
const sendTest = args.includes('--send-test');

const fileEnv = loadEnvFile(ENV_PATH);
const env = { ...fileEnv, ...process.env };

const TOKEN = env.TELEGRAM_BOT_TOKEN;
const CLOUD_URL = env.CLOUD_URL;

if (!TOKEN || !CLOUD_URL) {
  console.error('TELEGRAM_BOT_TOKEN / CLOUD_URL not set in .env.local. See .env.example.');
  process.exit(1);
}

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function appendEnvLine(line) {
  await appendFile(ENV_PATH, `\n${line}\n`);
}

async function main() {
  const me = await call('getMe');
  if (me.status === 401 || me.json?.ok === false) {
    console.error('토큰이 올바르지 않습니다 (BotFather에서 다시 확인)');
    process.exit(1);
  }
  console.log(`Bot: @${me.json.result.username}`);

  let chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    // getUpdates doesn't return anything while a webhook is set.
    await call('deleteWebhook');
    const updates = await call('getUpdates');
    const list = updates.json?.result ?? [];
    const privateMsg = [...list].reverse().find((u) => u.message?.chat?.type === 'private');
    if (!privateMsg) {
      console.error('봇에게 아무 메시지나 보낸 뒤 다시 실행하세요');
      process.exit(1);
    }
    chatId = String(privateMsg.message.chat.id);
    await appendEnvLine(`TELEGRAM_CHAT_ID=${chatId}`);
    console.log(`TELEGRAM_CHAT_ID set (…${chatId.slice(-3)})`);
  }

  let secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    secret = randomBytes(32).toString('base64url');
    await appendEnvLine(`TELEGRAM_WEBHOOK_SECRET=${secret}`);
    console.log('TELEGRAM_WEBHOOK_SECRET generated.');
  }

  const webhookUrl = `${CLOUD_URL.replace(/\/$/, '')}/api/telegram/webhook`;
  await call('setWebhook', {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
  console.log(`Webhook set: ${webhookUrl}`);

  await call('setMyCommands', {
    commands: [
      { command: 'today', description: '오늘 할 일·마감 요약' },
      { command: 'deadlines', description: '14일 내 마감' },
      { command: 'help', description: '사용법' },
    ],
  });
  console.log('Commands set.');

  if (pushToVercel) {
    const vercelToken = env.VERCEL_TOKEN;
    if (!vercelToken) {
      console.error('VERCEL_TOKEN not set — skipping Vercel env push.');
    } else {
      const vars = [
        ['TELEGRAM_BOT_TOKEN', TOKEN],
        ['TELEGRAM_CHAT_ID', chatId],
        ['TELEGRAM_WEBHOOK_SECRET', secret],
      ];
      for (const [name, value] of vars) {
        // Remove-then-add: `vercel env add` fails if the var already exists.
        spawnSync('npx', ['vercel', 'env', 'rm', name, 'production', '--yes', '--token', vercelToken], {
          cwd: ROOT,
          stdio: 'ignore',
          shell: process.platform === 'win32',
        });
        const add = spawnSync('npx', ['vercel', 'env', 'add', name, 'production', '--token', vercelToken], {
          cwd: ROOT,
          input: value, // no trailing newline — it would end up in the stored value
          stdio: ['pipe', 'ignore', 'ignore'],
          shell: process.platform === 'win32',
        });
        console.log(`Vercel env ${name}: ${add.status === 0 ? 'ok' : 'failed'}`);
      }
    }
  }

  if (sendTest) {
    const test = await call('sendMessage', { chat_id: chatId, text: '✅ Command Center 봇 연결됨' });
    console.log(`Test message: ${test.json?.ok ? 'sent' : 'failed'}`);
  }
}

main();
