export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} error for URL: ${url}`);
    this.name = "HttpError";
  }
}

export type FetchFn = typeof fetch;

export async function getJson(
  url: string,
  {
    fetchFn = fetch,
    timeoutMs = 1,
    signal,
  }: { fetchFn?: FetchFn; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);

  const res = await fetchFn(url, {
    headers: {
      "user-agent": "job-radar/0.1 (personal project)",
      accept: "application/json",
    },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) throw new HttpError(res.status, url);

  return await res.json();
}
