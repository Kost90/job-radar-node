import { expect, it, vi } from 'vitest';
import type { Source } from '../src/ats/types.ts';
import { runPipeline } from '../src/pipeline.ts';
import type { Profile } from '../src/profile.ts';
import type { JobSink } from '../src/sheets.ts';
import { makeJob } from './helpers.ts';

const profile: Profile = {
  titleKeywords: ['backend'],
  excludeTitleKeywords: [],
  skillKeywords: ['aws', 'typescript', 'node'],
  locations: ['london'],
  minScore: 70,
};

const source: Source = {
  name: 'greenhouse',
  fetchJobs: async () => [
    makeJob({ id: 'old', url: 'https://old' }), // already in the sheet
    makeJob({
      id: 'plain',
      url: 'https://plain',
      description: 'AWS TypeScript Node',
    }), // score 70
    makeJob({
      id: 'aws',
      url: 'https://aws',
      description: 'AWS TypeScript Node',
    }), // score 70
    makeJob({ id: 'id1', url: 'https://aws', description: 'AWS' }), // same URL twice in one run
    makeJob({ id: 'nope', url: 'https://nope', title: 'Designer' }), // filtered out
  ],
};

const deps = (sink: JobSink) => ({
  companies: [{ ats: 'greenhouse' as const, slug: 'acme' }],
  sources: { greenhouse: source, ashby: source, workable: source },
  profile,
  sink,
});

const fakeSink = () => ({
  existingIds: vi.fn(async () => new Set(['id1'])),
  append: vi.fn<JobSink['append']>(async () => {}),
});

it('filters, skips known and duplicate ids, sorts by score, writes once', async () => {
  const sink = fakeSink();
  const summary = await runPipeline(deps(sink));

  expect(summary).toMatchObject({
    fetched: 5,
    matched: 2,
    written: 2,
    dryRun: false,
  });
  expect(sink.append).toHaveBeenCalledTimes(1);
  expect(sink.append.mock.calls[0]?.[0].map((m) => m.job.id)).toEqual(['plain', 'aws']);
});

it('dry run computes everything but writes nothing', async () => {
  const sink = fakeSink();
  const summary = await runPipeline(deps(sink), { dryRun: true });

  expect(summary).toMatchObject({ written: 0, dryRun: true });
  expect(summary.top).toHaveLength(2);
  expect(sink.append).not.toHaveBeenCalled();
});
