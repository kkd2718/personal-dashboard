// Manual tool-use loop for /ask (docs/PLAN_ASK.md §3.4): explicit control of the deadline,
// iteration cap and per-call spend. Assistant content (thinking blocks + signatures
// included) is passed back verbatim between turns.
import type Anthropic from '@anthropic-ai/sdk';
import { MODEL_SETTINGS, type AskModel } from '@/lib/logic/ask-cost';
import { extractText } from '@/lib/logic/ask-text';
import type { AskClient } from '@/lib/ask/client';
import { runTool, type AskRepo, type ToolOutcome } from '@/lib/ask/tools';

export interface UsageTotals {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface LoopInput {
  client: AskClient;
  repo: AskRepo;
  model: AskModel;
  system: Anthropic.Messages.TextBlockParam[];
  tools: Anthropic.Messages.Tool[];
  messages: Anthropic.Messages.MessageParam[];
  today: string;
  /** Epoch ms. */
  deadlineAt: number;
  maxIterations?: number;
  /** Overrides the model's default output cap (long-form answers). */
  maxTokens?: number;
  onUsage?(model: AskModel, usage: Anthropic.Messages.Usage): Promise<void>;
  toolHandler?(name: string, input: unknown): Promise<ToolOutcome>;
}

export interface LoopResult {
  text: string;
  stopReason: string | null;
  /** Tool-phase calls made (the final answer call is not counted). */
  iterations: number;
  usage: UsageTotals;
  /** True when the deadline passed before any further call could be made. */
  timedOut: boolean;
}

const FINAL_MARGIN_MS = 8000;
const FINAL_NUDGE = '도구 사용 한도에 도달했어요. 지금까지 모은 정보만으로 답해 주세요.';

/** Same messages with `nudge` appended to the last (user) message so the model answers now. */
function withNudge(messages: Anthropic.Messages.MessageParam[]): Anthropic.Messages.MessageParam[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || typeof last.content === 'string') return messages;
  return [...messages.slice(0, -1), { role: 'user', content: [...last.content, { type: 'text', text: FINAL_NUDGE }] }];
}

export async function runAskLoop(input: LoopInput): Promise<LoopResult> {
  const { client, model, system, tools } = input;
  const settings = MODEL_SETTINGS[model];
  const maxIterations = input.maxIterations ?? 6;
  const handle = input.toolHandler ?? ((name, raw) => runTool(input.repo, name, raw, { today: input.today }));
  const messages = [...input.messages];
  const usage: UsageTotals = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let iterations = 0;
  let text = '';
  let stopReason: string | null = null;

  const call = async (final: boolean) => {
    // Final call keeps the (cached) tools but forbids using them: tool_use/tool_result blocks in the
    // history need `tools` defined, and omitting them would also bust the prompt cache.
    const res = await client.create({
      model,
      max_tokens: input.maxTokens ?? settings.maxTokens,
      thinking: settings.thinking,
      ...(settings.effort ? { output_config: { effort: settings.effort } } : {}),
      system,
      tools,
      messages: final ? withNudge(messages) : messages,
      ...(final ? { tool_choice: { type: 'none' as const } } : {}),
    });
    usage.input += res.usage.input_tokens;
    usage.output += res.usage.output_tokens;
    usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;
    usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
    await input.onUsage?.(model, res.usage);
    text = extractText(res.content);
    stopReason = res.stop_reason;
    return res;
  };

  for (;;) {
    const left = input.deadlineAt - Date.now();
    if (left <= 0) return { text, stopReason, iterations, usage, timedOut: true };
    if (iterations >= maxIterations || left < FINAL_MARGIN_MS) {
      await call(true);
      return { text, stopReason, iterations, usage, timedOut: false };
    }

    const res = await call(false);
    iterations++;
    const assistant = res.content as Anthropic.Messages.ContentBlockParam[];
    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: assistant });
      continue;
    }
    const uses = res.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || uses.length === 0) {
      return { text, stopReason, iterations, usage, timedOut: false };
    }

    messages.push({ role: 'assistant', content: assistant });
    const results = await Promise.all(
      uses.map(async (u): Promise<Anthropic.Messages.ToolResultBlockParam> => {
        let out: ToolOutcome;
        try {
          out = await handle(u.name, u.input);
        } catch {
          out = { content: '도구 실행에 실패했어요', isError: true };
        }
        return { type: 'tool_result', tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) };
      })
    );
    messages.push({ role: 'user', content: results });
  }
}
