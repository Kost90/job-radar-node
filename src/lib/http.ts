import { setTimeout as delay } from 'node:timers/promises';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly retryAfterMs?: number,
  ) {
    super(`HTTP ${status} error for URL: ${url}`);
    this.name = 'HttpError';
  }
}

export interface GetJsonOptions {
  fetchFn?: FetchFn;
  timeoutMs?: number;
  signal?: AbortSignal;
  retries?: number; // extra attempts after the first one
  baseDelayMs?: number;
  maxDelayMs?: number; // don't wait longer than this between attempts
}

export type FetchFn = typeof fetch;

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> => delay(ms, undefined, { signal });

/** Retry only what can succeed next time: 408, 429, 5xx, network errors, our own timeout. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 408 || err.status === 429 || err.status >= 500;
  if (err instanceof Error) return err.name === 'TimeoutError' || err.name === 'TypeError';
  return false;
}

/** Retry-After is either seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1000 : undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) || at <= now ? undefined : at - now;
}

export async function getJsonOnce(
  url: string,
  { fetchFn = fetch, timeoutMs = 15_000, signal }: GetJsonOptions = {},
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);

  const res = await fetchFn(url, {
    headers: {
      'user-agent': 'job-radar/0.1 (personal project)',
      accept: 'application/json',
    },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (!res.ok) {
    await res.body?.cancel().catch(() => {}); // free the connection
    throw new HttpError(res.status, url, parseRetryAfter(res.headers.get('retry-after')));
  }

  return (await res.json()) as unknown;
}

export async function getJson(url: string, options: GetJsonOptions = {}): Promise<unknown> {
  const { retries = 2, baseDelayMs = 500, maxDelayMs = 30_000 } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await getJsonOnce(url, options);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err) || options.signal?.aborted) throw err;

      const backoff = Math.random() * baseDelayMs * 2 ** attempt;
      const wait = err instanceof HttpError && err.retryAfterMs ? Math.max(err.retryAfterMs, backoff) : backoff;
      if (wait > maxDelayMs) throw err; // server asks us to wait too long: give up now

      await sleep(wait, options.signal);
    }
  }
}
