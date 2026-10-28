import * as z from 'zod/mini';
import { type FetchFn, postJson } from './lib/http.ts';

const API = 'https://api.anthropic.com/v1/messages';

const PRICE = { input: 0.1, output: 0.5 };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

export const costUsd = (u: Usage) => (u.inputTokens * PRICE.input + u.outputTokens * PRICE.output) / 1_000_000;

export class LlmError extends Error {
  constructor(
    message: string,
    readonly usage: Usage,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** JSON Schema the model's answer must follow (structured outputs). */
export type JsonSchema = Record<string, unknown>;

export interface LlmRequest {
  system: string;
  user: string;
  schema: JsonSchema;
  maxTokens: number;
}

export interface Llm {
  json(req: LlmRequest): Promise<{ data: unknown; usage: Usage }>;
}

const ResponseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.optional(z.string()) })),
  stop_reason: z.nullable(z.string()),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

export function anthropic(opts: {
  apiKey: () => Promise<string>;
  model: string;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}): Llm {
  const { apiKey, model, fetchFn, timeoutMs = 60_000 } = opts;

  return {
    async json({ system, user, schema, maxTokens }): Promise<{
      data: unknown;
      usage: Usage;
    }> {
      const raw = await postJson(
        API,
        {
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
          // a short classification: no extended thinking, low effort = fewer tokens, faster answer
          thinking: { type: 'disabled' },
          output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        },
        {
          fetchFn,
          timeoutMs,
          retries: 2,
          baseDelayMs: 1000,
          label: `anthropic ${model}`,
          headers: { 'x-api-key': await apiKey(), 'anthropic-version': '2023-06-01' },
        },
      );

      const res = ResponseSchema.parse(raw);
      const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
      if (res.stop_reason === 'refusal') throw new LlmError('model refused', usage);
      if (res.stop_reason === 'max_tokens') throw new LlmError('answer cut off by max_tokens', usage);

      // pick the block by type: a thinking block can come first
      const text = res.content.find((b) => b.type === 'text')?.text;
      if (text === undefined) throw new LlmError(`no text block, stop_reason=${res.stop_reason}`, usage);
      return { data: JSON.parse(text), usage };
    },
  };
}
