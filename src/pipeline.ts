import type { AtsName, Source } from './ats/types.ts';
import type { Company } from './config.ts';
import { type CrawlError, crawl } from './crawl.ts';
import { matchJob } from './filter.ts';
import { addUsage, type Usage } from './llm.ts';
import { formatSummary, type Notifier } from './notify.ts';
import type { Profile } from './profile.ts';
import type { AiScorer } from './scoring.ts';
import type { SeenStore } from './seen.ts';
import type { JobSink, ScoredJob } from './sheets.ts';

export interface PipelineDeps {
  companies: Company[];
  sources: Record<AtsName, Source>;
  profile: Profile;
  seen: SeenStore;
  sink: JobSink;
  scorer?: AiScorer;
  notifier?: Notifier;
  sheetUrl?: string;
}

export interface PipelineSummary {
  fetched: number;
  matched: number;
  written: number;
  dryRun: boolean;
  top: ScoredJob[];
  errors: CrawlError[];
  aiScored: number;
  notified: boolean;
  usage: Usage;
  warnings: string[];
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

  const base = { fetched: jobs.length, matched: matched.length, dryRun, errors, notified: false };
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const warnings: string[] = [];
  if (dryRun) {
    // touches neither DynamoDB, the sheet, the LLM nor Telegram: free to run as often as needed
    return { ...base, written: 0, top: candidates.slice(0, 5), aiScored: 0, usage, warnings };
  }

  const claimed = await deps.seen.claim(candidates);

  // 1. LLM score only NEW jobs (a few a day), never the whole crawl (hundreds)
  let fresh = claimed;
  let aiScored = 0;
  if (deps.scorer && claimed.length > 0) {
    try {
      const r = await deps.scorer.score(claimed);
      fresh = r.jobs;
      aiScored = r.scored;
      usage = addUsage(usage, r.usage);
      for (const f of r.failed) warnings.push(`ai score failed for ${f.url}: ${f.error}`);
      if (r.skipped > 0) warnings.push(`${r.skipped} jobs over the per-run LLM limit, written without AI score`);
    } catch (err) {
      // e.g. the resume could not be read: write the jobs without AI columns rather than lose them
      warnings.push(`ai scoring skipped: ${message(err)}`);
    }
  }

  // 2. the sheet is the source of truth: if this fails, the run fails and the jobs are released
  try {
    await deps.sink.append(fresh);
  } catch (err) {
    // not delivered = not seen, so the next run retries them
    await deps.seen.release(fresh);
    throw err;
  }

  // 3. Telegram: may fail on its own without failing the run (the jobs are already in the sheet)
  let notified = false;
  if (deps.notifier && fresh.length > 0) {
    try {
      await deps.notifier.send(formatSummary(fresh, { sheetUrl: deps.sheetUrl }));
      notified = true;
    } catch (err) {
      warnings.push(`telegram failed: ${message(err)}`);
    }
  }

  return { ...base, written: fresh.length, top: fresh.slice(0, 5), aiScored, notified, usage, warnings };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
