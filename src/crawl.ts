import pLimit from 'p-limit';
import type { AtsName, Job, Source } from './ats/types.ts';
import type { Company } from './config.ts';

export interface CrawlError {
  company: Company;
  message: string;
}

export interface CrawlResult {
  jobs: Job[];
  errors: CrawlError[];
}

export interface CrawlOptions {
  concurrency?: number;
  signal?: AbortSignal;
}

/** fetch jobs by companies */
export async function crawl(
  companies: Company[],
  sources: Record<AtsName, Source>,
  { concurrency = 4, signal }: CrawlOptions = {},
): Promise<CrawlResult> {
  const limit = pLimit(concurrency);
  const settled = await Promise.allSettled(
    companies.map((company) => limit(() => sources[company.ats].fetchJobs(company.slug, signal))),
  );

  const result: CrawlResult = { jobs: [], errors: [] };
  for (const [i, outcome] of settled.entries()) {
    const company = companies[i]; // allSettled keeps the input order
    if (!company) continue;
    if (outcome.status === 'fulfilled') result.jobs.push(...outcome.value);
    else result.errors.push({ company, message: String(outcome.reason) });
  }
  return result;
}
