import type { AtsName, Source } from './ats/types.ts';
import type { Company } from './config.ts';
import { type CrawlError, crawl } from './crawl.ts';
import { matchJob } from './filter.ts';
import type { Profile } from './profile.ts';
import type { SeenStore } from './seen.ts';
import type { JobSink, ScoredJob } from './sheets.ts';

export interface PipelineDeps {
  companies: Company[];
  sources: Record<AtsName, Source>;
  profile: Profile;
  seen: SeenStore;
  sink: JobSink;
}

export interface PipelineSummary {
  fetched: number;
  matched: number;
  written: number;
  dryRun: boolean;
  top: ScoredJob[];
  errors: CrawlError[];
}

export async function runPipeline(deps: PipelineDeps, { dryRun = false } = {}): Promise<PipelineSummary> {
  const { jobs, errors } = await crawl(deps.companies, deps.sources);

  const matched = jobs.map((job): ScoredJob => ({ job, ...matchJob(job, deps.profile) })).filter((m) => m.match);

  // the same posting can be listed twice in one run (e.g. two locations, one URL)
  const urls = new Set<string>();
  const candidates: ScoredJob[] = [];
  for (const m of matched) {
    if (urls.has(m.job.url)) continue;
    urls.add(m.job.url);
    candidates.push(m);
  }
  candidates.sort((a, b) => b.score - a.score);

  const summary = {
    fetched: jobs.length,
    matched: matched.length,
    dryRun,
    errors,
  };
  if (dryRun) return { ...summary, written: 0, top: candidates.slice(0, 5) };

  const fresh = await deps.seen.claim(candidates);
  try {
    await deps.sink.append(fresh);
  } catch (err) {
    await deps.seen.release(fresh);
    throw err;
  }
  return { ...summary, written: fresh.length, top: fresh.slice(0, 5) };
}
