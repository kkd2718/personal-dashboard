#!/usr/bin/env node
// One tiny Haiku call to verify the Anthropic SDK shapes (docs/PLAN_ASK.md step 0).
// Prints stop_reason, block types and usage — never the key.
// Usage: node --env-file=.env.local scripts/ask-probe.mjs [model]
import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY not set in .env.local');
  process.exit(1);
}
const model = process.argv[2] ?? 'claude-haiku-5-5';
const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 25_000 });

try {
  const res = await client.messages.create({
    model,
    max_tokens: 256,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: '한 문장으로 인사해 주세요.' }],
  });
  console.log('model:', res.model);
  console.log('stop_reason:', res.stop_reason);
  console.log('blocks:', res.content.map((b) => b.type).join(','));
  console.log('usage:', JSON.stringify(res.usage));
  console.log('text:', res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
} catch (e) {
  console.error('probe failed:', e?.status ?? '', e?.message?.slice(0, 300) ?? String(e));
  process.exit(1);
}
