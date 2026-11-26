import { describe, expect, it, vi } from 'vitest';
import type { AtsName, Job, Source } from '../src/ats/types.ts';
import type { Company } from '../src/config.ts';
import type { Notifier } from '../src/notify.ts';
import { type PipelineDeps, runPipeline } from '../src/pipeline.ts';
import type { Profile } from '../src/profile.ts';
import type { AiScorer, ScoringResult } from '../src/scoring.ts';
import { memorySeenStore, type SeenStore } from '../src/seen.ts';
import type { JobSink, ScoredJob } from '../src/sheets.ts';
import { makeJob } from './helpers.ts';

const profile: Profile = {
  titleKeywords: ['backend'],
  excludeTitleKeywords: ['intern'],
  skillKeywords: ['typescript', 'aws', 'sql'],
  locations: ['london'],
  minScore: 50,
};

// keyword score = 40 + 10 per skill: "typescript" -> 50, "typescript aws sql" -> 70
const job = (id: string, overrides: Partial<Job> = {}): Job =>
  makeJob({ id, url: `https://jobs.example/${id}`, description: 'typescript', ...overrides });

const sourcesFor = (bySlug: Record<string, Job[] | Error>): Record<AtsName, Source> => {
  const fetchJobs = vi.fn(async (slug: string) => {
    const r = bySlug[slug] ?? [];
    if (r instanceof Error) throw r;
    return r;
  });
  return {
    greenhouse: { name: 'greenhouse', fetchJobs },
    ashby: { name: 'ashby', fetchJobs },
    workable: { name: 'workable', fetchJobs },
  };
};

const fakeSink = (): JobSink & { append: ReturnType<typeof vi.fn> } => ({
  append: vi.fn(async () => {}),
  existingIds: vi.fn(async () => new Set<string>()),
});

const fakeScorer = (impl?: (jobs: ScoredJob[]) => Promise<ScoringResult>) => {
  const score = vi.fn(
    impl ??
      (async (jobs: ScoredJob[]): Promise<ScoringResult> => ({
        jobs: jobs.map((m) => ({ ...m, ai: { score: 90, recommendation: 'apply_as_is', advice: 'ok', gaps: [] } })),
        usage: { inputTokens: 10, outputTokens: 5 },
        scored: jobs.length,
        failed: [],
        skipped: 0,
      })),
  );
  return { score } satisfies AiScorer;
};

const fakeNotifier = (): Notifier & { send: ReturnType<typeof vi.fn> } => ({ send: vi.fn(async () => {}) });

const acme: Company = { ats: 'greenhouse', slug: 'acme' };

const deps = (jobs: Job[], overrides: Partial<PipelineDeps> = {}) => ({
  companies: [acme],
  sources: sourcesFor({ acme: jobs }),
  profile,
  seen: memorySeenStore(),
  sink: fakeSink(),
  scorer: fakeScorer(),
  notifier: fakeNotifier(),
  ...overrides,
});

const appended = (sink: JobSink): ScoredJob[] => vi.mocked(sink.append).mock.calls[0]?.[0] ?? [];

describe('runPipeline', () => {
  it('claims, scores, writes and notifies new matching jobs', async () => {
    const d = deps([job('1'), job('2')]);
    const summary = await runPipeline(d);

    expect(summary).toMatchObject({
      fetched: 2,
      matched: 2,
      written: 2,
      aiScored: 2,
      notified: true,
      dryRun: false,
      errors: [],
      warnings: [],
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(d.scorer.score).toHaveBeenCalledOnce();
    expect(appended(d.sink).every((m) => m.ai?.recommendation === 'apply_as_is')).toBe(true);
    expect(d.notifier.send).toHaveBeenCalledOnce();
  });

  it('drops jobs that do not match the profile', async () => {
    const d = deps([job('1'), job('2', { title: 'Frontend Engineer' }), job('3', { location: 'New York' })]);
    const summary = await runPipeline(d);

    expect(summary).toMatchObject({ fetched: 3, matched: 1, written: 1 });
    expect(appended(d.sink).map((m) => m.job.id)).toEqual(['1']);
  });

  it('dedups jobs with the same URL within one run', async () => {
    const d = deps([job('1', { url: 'https://jobs.example/same' }), job('2', { url: 'https://jobs.example/same' })]);
    const summary = await runPipeline(d);

    expect(summary).toMatchObject({ matched: 2, written: 1 });
    expect(appended(d.sink)).toHaveLength(1);
  });

  it('sorts candidates by keyword score, highest first', async () => {
    const d = deps([job('low'), job('high', { description: 'typescript aws sql' })], { scorer: undefined });
    await runPipeline(d);

    expect(appended(d.sink).map((m) => [m.job.id, m.score])).toEqual([
      ['high', 70],
      ['low', 50],
    ]);
  });

  it('dry run touches neither the seen store, the sink, the LLM nor Telegram', async () => {
    const seen = memorySeenStore();
    const claim = vi.spyOn(seen, 'claim');
    const d = deps([job('1'), job('2')], { seen });
    const summary = await runPipeline(d, { dryRun: true });

    expect(summary).toMatchObject({ fetched: 2, matched: 2, written: 0, aiScored: 0, notified: false, dryRun: true });
    expect(summary.top).toHaveLength(2);
    expect(claim).not.toHaveBeenCalled();
    expect(d.sink.append).not.toHaveBeenCalled();
    expect(d.scorer.score).not.toHaveBeenCalled();
    expect(d.notifier.send).not.toHaveBeenCalled();
  });

  it('skips jobs already seen in a previous run', async () => {
    const seen = memorySeenStore();
    await runPipeline(deps([job('1')], { seen }));

    const d = deps([job('1')], { seen });
    const summary = await runPipeline(d);

    expect(summary).toMatchObject({ matched: 1, written: 0, aiScored: 0, notified: false });
    expect(d.scorer.score).not.toHaveBeenCalled();
    expect(d.notifier.send).not.toHaveBeenCalled();
  });

  it('scores and writes only the new jobs when some were seen before', async () => {
    const seen = memorySeenStore();
    await runPipeline(deps([job('1')], { seen }));

    const d = deps([job('1'), job('2')], { seen });
    const summary = await runPipeline(d);

    expect(summary).toMatchObject({ matched: 2, written: 1, aiScored: 1 });
    expect(d.scorer.score).toHaveBeenCalledOnce();
    expect(vi.mocked(d.scorer.score).mock.calls[0]?.[0].map((m) => m.job.id)).toEqual(['2']);
    expect(d.sink.append).toHaveBeenCalledOnce();
    expect(appended(d.sink).map((m) => m.job.id)).toEqual(['2']);
  });

  it('reports a failing company and still writes the others', async () => {
    const broken: Company = { ats: 'greenhouse', slug: 'broken' };
    const d = deps([], {
      companies: [acme, broken],
      sources: sourcesFor({ acme: [job('1')], broken: new Error('HTTP 500') }),
    });
    const summary = await runPipeline(d);

    expect(summary.written).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.company).toEqual(broken);
  });

  it('turns per-job scoring failures and the LLM cap into warnings', async () => {
    const scorer = fakeScorer(async (jobs) => ({
      jobs,
      usage: { inputTokens: 1, outputTokens: 1 },
      scored: 0,
      failed: [{ url: 'https://jobs.example/1', error: 'bad json' }],
      skipped: 1,
    }));
    const d = deps([job('1'), job('2')], { scorer });
    const summary = await runPipeline(d);

    expect(summary.written).toBe(2);
    expect(summary.warnings).toEqual([
      'ai score failed for https://jobs.example/1: bad json',
      '1 jobs over the per-run LLM limit, written without AI score',
    ]);
  });

  it('writes jobs with keyword scores when the whole scorer fails', async () => {
    const scorer = fakeScorer(async () => {
      throw new Error('resume missing');
    });
    const d = deps([job('1')], { scorer });
    const summary = await runPipeline(d);

    expect(summary).toMatchObject({ written: 1, aiScored: 0, warnings: ['ai scoring skipped: resume missing'] });
    expect(appended(d.sink)[0]?.ai).toBeUndefined();
  });

  it('works without a scorer and a notifier', async () => {
    const d = deps([job('1')], { scorer: undefined, notifier: undefined });
    const summary = await runPipeline(d);

    expect(summary).toMatchObject({ written: 1, aiScored: 0, notified: false, warnings: [] });
  });

  it('releases the claims when the sheet append fails, so the next run retries', async () => {
    const seen = memorySeenStore();
    const release = vi.spyOn(seen, 'release');
    const sink = fakeSink();
    sink.append.mockRejectedValueOnce(new Error('sheets down'));
    const d = deps([job('1')], { seen, sink });

    await expect(runPipeline(d)).rejects.toThrow('sheets down');
    expect(release).toHaveBeenCalledOnce();
    expect(release.mock.calls[0]?.[0].map((m) => m.job.id)).toEqual(['1']);
    expect(d.notifier.send).not.toHaveBeenCalled();

    const retry = await runPipeline(deps([job('1')], { seen }));
    expect(retry.written).toBe(1);
  });

  it('throws an AggregateError when both the append and the release fail', async () => {
    const seen: SeenStore = {
      claim: async (jobs) => jobs,
      release: async () => {
        throw new Error('dynamo down');
      },
    };
    const sink = fakeSink();
    sink.append.mockRejectedValueOnce(new Error('sheets down'));

    const err = await runPipeline(deps([job('1')], { seen, sink })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AggregateError);
    expect((err as AggregateError).message).toContain('sheets down');
    expect((err as AggregateError).message).toContain('dynamo down');
    expect((err as AggregateError).errors).toHaveLength(2);
  });

  it('does not fail the run when Telegram fails', async () => {
    const notifier = fakeNotifier();
    notifier.send.mockRejectedValueOnce(new Error('bot blocked'));
    const d = deps([job('1')], { notifier });
    const summary = await runPipeline(d);

    expect(summary).toMatchObject({ written: 1, notified: false, warnings: ['telegram failed: bot blocked'] });
    expect(d.sink.append).toHaveBeenCalledOnce();
  });

  it('returns at most 5 top jobs but writes all of them', async () => {
    const jobs = Array.from({ length: 7 }, (_, i) => job(String(i)));
    const summary = await runPipeline(deps(jobs));

    expect(summary.written).toBe(7);
    expect(summary.top).toHaveLength(5);
  });
});
