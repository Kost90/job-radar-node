import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getJson, HttpError } from '../src/lib/http.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5); // deterministic jitter
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('retries 503 and then succeeds', async () => {
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('busy', { status: 503 }))
    .mockResolvedValueOnce(new Response('{"ok":true}'));

  const promise = getJson('https://x.test', { fetchFn });
  await vi.runAllTimersAsync(); // skip the backoff sleep instantly

  await expect(promise).resolves.toEqual({ ok: true });
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

it('does not retry 404', async () => {
  const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('nf', { status: 404 }));

  await expect(getJson('https://x.test', { fetchFn })).rejects.toBeInstanceOf(HttpError);
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

it('gives up after 1 + retries attempts', async () => {
  const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => new Response('down', { status: 500 }));

  const promise = getJson('https://x.test', { fetchFn, retries: 2 });
  const assertion = expect(promise).rejects.toMatchObject({ status: 500 });
  await vi.runAllTimersAsync();

  await assertion;
  expect(fetchFn).toHaveBeenCalledTimes(3);
});

it('keeps the error body in the message (the API says what was wrong)', async () => {
  const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"error":"bad schema"}', { status: 400 }));
  await expect(getJson('https://x.test', { fetchFn })).rejects.toThrow(
    'HTTP 400 for https://x.test: {"error":"bad schema"}',
  );
});

it('retries 408 Request Timeout', async () => {
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('slow', { status: 408 }))
    .mockResolvedValueOnce(new Response('{"ok":true}'));
  const promise = getJson('https://x.test', { fetchFn });
  await vi.runAllTimersAsync();
  await expect(promise).resolves.toEqual({ ok: true });
});

it('stops waiting between retries when the caller aborts', async () => {
  const controller = new AbortController();
  const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('down', { status: 503 }));
  const promise = getJson('https://x.test', { fetchFn, signal: controller.signal, baseDelayMs: 60_000 });
  const assertion = expect(promise).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(0); // first attempt fails, the backoff sleep starts
  controller.abort();
  await assertion;
  expect(fetchFn).toHaveBeenCalledTimes(1);
});
