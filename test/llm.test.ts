import { expect, it, vi } from 'vitest';
import { anthropic, costUsd, LlmError } from '../src/llm.ts';

const reply = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
const ok = (text: string, extra: object = {}) =>
  reply({
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 2000, output_tokens: 100 },
    ...extra,
  });

const make = (fetchFn: typeof fetch) =>
  anthropic({ apiKey: async () => 'sk-test', model: 'claude-haiku-5-5', fetchFn });
const req = { system: 's', user: 'u', schema: { type: 'object' }, maxTokens: 100 };

it('sends structured-output request and parses the text block, not the first block', async () => {
  const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(ok('{"score":80}'));
  const res = await make(fetchFn).json(req);

  expect(res).toEqual({ data: { score: 80 }, usage: { inputTokens: 2000, outputTokens: 100 } });
  const [url, init] = fetchFn.mock.calls[0] ?? [];
  expect(url).toBe('https://api.anthropic.com/v1/messages');
  const headers = init?.headers as Record<string, string>;
  expect(headers['x-api-key']).toBe('sk-test');
  expect(headers['anthropic-version']).toBe('2023-06-01');
  const body = JSON.parse(String(init?.body));
  expect(body).toMatchObject({
    model: 'claude-haiku-5-5',
    max_tokens: 100,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } },
  });
  expect(body).not.toHaveProperty('temperature');
});

it('turns refusal and max_tokens into LlmError that still carries usage', async () => {
  for (const stop_reason of ['refusal', 'max_tokens']) {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(ok('{"sc', { stop_reason }));
    const err = await make(fetchFn)
      .json(req)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).usage.inputTokens).toBe(2000);
  }
});

it('does not retry a 400 and shows the API message', async () => {
  const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(reply({ error: { message: 'bad schema' } }, 400));
  await expect(make(fetchFn).json(req)).rejects.toThrow(/400 for anthropic claude-haiku-5-5: .*bad schema/);
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

it('prices tokens', () => {
  // 50 jobs x (3000 in + 150 out) tokens
  expect(costUsd({ inputTokens: 150_000, outputTokens: 7_500 })).toBeCloseTo(0.01875, 5);
});
