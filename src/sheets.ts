import { z } from 'zod/mini';
import type { Job } from './ats/types.ts';
import type { MatchResult } from './filter.ts';
import type { FetchFn } from './lib/http.ts';
import type { AiVerdict } from './scoring.ts';

export type ScoredJob = { job: Job; ai?: AiVerdict } & MatchResult;

export interface JobSink {
  append(jobs: ScoredJob[]): Promise<void>;
  existingIds(): Promise<Set<string>>;
}

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export const HEADER = [
  'Date',
  'Id',
  'Company',
  'Title',
  'Location',
  'Score',
  'URL',
  'Source',
  'AI score',
  'Recommendation',
  'Advice',
  'Gaps',
];

const ID_COLUMN = 'B';

export function toRow({ job, score, ai }: ScoredJob, now: Date): (string | number)[] {
  return [
    now.toISOString().slice(0, 10),
    job.id,
    job.company,
    job.title,
    job.location,
    score,
    job.url,
    job.source,
    ai?.score ?? '', // empty = not scored (LLM off, failed or over the per-run limit)
    ai?.recommendation ?? '',
    ai?.advice ?? '',
    ai?.gaps.join('; ') ?? '',
  ];
}

export function sheetsSink(opts: {
  spreadsheetId: string;
  sheetName: string;
  getToken: () => Promise<string>;
  fetchFn?: FetchFn;
  now?: () => Date;
}): JobSink {
  const { spreadsheetId, sheetName, getToken, fetchFn = fetch, now = () => new Date() } = opts;
  const base = `${API}/${encodeURIComponent(spreadsheetId)}/values`;

  async function call(url: string, init: RequestInit = {}) {
    const res = await fetchFn(url, {
      ...init,
      headers: {
        authorization: `Bearer ${await getToken()}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`);
    return res.json() as Promise<unknown>;
  }

  return {
    async existingIds() {
      const range = encodeURIComponent(`${sheetName}!${ID_COLUMN}2:${ID_COLUMN}`);
      const data = z.object({ values: z.optional(z.array(z.array(z.string()))) }).parse(await call(`${base}/${range}`));
      return new Set((data.values ?? []).map((row) => row[0] ?? '').filter(Boolean));
    },
    async append(jobs) {
      if (jobs.length === 0) return;
      const range = encodeURIComponent(`${sheetName}!A1`);
      const url = `${base}/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      const date = now();
      await call(url, {
        method: 'POST',
        body: JSON.stringify({ values: jobs.map((j) => toRow(j, date)) }),
      });
    },
  };
}
