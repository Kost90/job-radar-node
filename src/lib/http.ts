export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string, // already safe to log: callers pass a label instead of a URL that holds a secret
    readonly retryAfterMs?: number,
    readonly body?: string, // first 500 chars of the error response: the API usually says what was wrong
  ) {
    super(`HTTP ${status} for ${url}${body ? `: ${body}` : ''}`);
    this.name = 'HttpError';
  }
}

export type FetchFn = typeof fetch;

export interface RequestOptions {
  fetchFn?: FetchFn;
  timeoutMs?: number;
  signal?: AbortSignal;
  retries?: number; // extra attempts after the first one
  baseDelayMs?: number;
  headers?: Record<string, string>;
  /** what errors and logs show instead of the URL (Telegram puts the bot token into the path) */
  label?: string;
}

export type GetJsonOptions = RequestOptions;

/**
 * Abortable sleep on the global setTimeout, so vi.useFakeTimers() can skip it in tests.
 * (node:timers/promises is not faked by default: tests would really wait.)
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Retry only what can succeed next time: 408, 429, 5xx (Anthropic's 529 "overloaded" too), network errors, timeout. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 408 || err.status === 429 || err.status >= 500;
  if (err instanceof Error) return err.name === 'TimeoutError' || err.name === 'TypeError';
  return false;
}

async function requestOnce(url: string, init: { method: string; body?: string }, options: RequestOptions) {
  const { fetchFn = fetch, timeoutMs = 15_000, signal, headers = {}, label = url } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetchFn(url, {
    method: init.method,
    body: init.body,
    headers: { 'user-agent': 'job-radar/0.1 (personal project)', accept: 'application/json', ...headers },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after'));
    // reading the text consumes the body, so the connection is freed: no cancel() needed
    const body = (await res.text().catch(() => '')).slice(0, 500);
    throw new HttpError(
      res.status,
      label,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      body,
    );
  }
  return res.json() as Promise<unknown>;
}

async function withRetry<T>(fn: () => Promise<T>, { retries = 2, baseDelayMs = 500, signal }: RequestOptions) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err) || signal?.aborted) throw err;
      // exponential backoff with "full jitter": random delay in [0, base * 2^attempt)
      const backoff = Math.random() * baseDelayMs * 2 ** attempt;
      const waitMs = err instanceof HttpError && err.retryAfterMs ? Math.max(err.retryAfterMs, backoff) : backoff;
      await sleep(waitMs, signal); // an aborted run stops waiting at once
    }
  }
}

export function getJson(url: string, options: RequestOptions = {}): Promise<unknown> {
  return withRetry(() => requestOnce(url, { method: 'GET' }, options), options);
}

export function postJson(url: string, body: unknown, options: RequestOptions = {}): Promise<unknown> {
  const headers = { 'content-type': 'application/json', ...options.headers };
  const json = JSON.stringify(body);
  return withRetry(() => requestOnce(url, { method: 'POST', body: json }, { ...options, headers }), options);
}
