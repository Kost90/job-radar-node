import type { AtsName, Source } from './ats/types.ts';
import type { Company } from './config.ts';
import { type CrawlError, crawl } from './crawl.ts';
import { matchJob } from './filter.ts';
import type { Profile } from './profile.ts';
import type { JobSink, ScoredJob } from './sheets.ts';

export interface PipelineDeps {
  companies: Company[];
  sources: Record<AtsName, Source>;
  profile: Profile;
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

  const seen = await deps.sink.existingIds();
  const fresh: ScoredJob[] = [];
  for (const m of matched) {
    if (seen.has(m.job.id)) continue;
    seen.add(m.job.id); // also dedupes the same job listed twice in one run
    fresh.push(m);
  }
  fresh.sort((a, b) => b.score - a.score);

  if (!dryRun) await deps.sink.append(fresh);

  return {
    fetched: jobs.length,
    matched: matched.length,
    written: dryRun ? 0 : fresh.length,
    dryRun,
    top: fresh.slice(0, 5),
    errors,
  };
}
