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
}

export type FetchFn = typeof fetch;

export const sleep = async (ms: number): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry only what can succeed next time: 429, 5xx, network errors, our own timeout. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  if (err instanceof Error) return err.message === 'TimeoutError' || err.name === 'TypeError';
  return false;
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
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new HttpError(res.status, url, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined);
  }

  return (await res.json()) as Promise<unknown>;
}

export async function getJson(url: string, options: GetJsonOptions = {}): Promise<unknown> {
  const { retries = 2, baseDelayMs = 500 } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await getJsonOnce(url, options);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err) || options.signal?.aborted) throw err;

      const backoff = Math.random() * baseDelayMs * 2 ** attempt;
      const delay = err instanceof HttpError && err.retryAfterMs ? Math.max(err.retryAfterMs, backoff) : backoff;
      await sleep(delay);
    }
  }
}
