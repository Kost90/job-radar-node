import { expect, it } from 'vitest';
import type { Job, Source } from '../src/ats/types.ts';
import { crawl } from '../src/crawl.ts';

const job = (company: string): Job => ({
  source: 'greenhouse',
  company,
  id: company,
  title: 't',
  location: '',
  url: '',
  description: '',
  updatedAt: new Date(0),
});

it('collects jobs and per-company errors without failing the whole run', async () => {
  const fake: Source = {
    name: 'greenhouse',
    fetchJobs: async (company) => {
      if (company === 'broken') throw new Error('boom');
      return [job(company)];
    },
  };
  const sources = { greenhouse: fake, ashby: fake, workable: fake };

  const { jobs, errors } = await crawl(
    [
      { ats: 'greenhouse', slug: 'a' },
      { ats: 'greenhouse', slug: 'broken' },
      { ats: 'ashby', slug: 'b' },
    ],
    sources,
  );

  expect(jobs.map((j) => j.company)).toEqual(['a', 'b']);
  expect(errors).toEqual([{ company: { ats: 'greenhouse', slug: 'broken' }, message: 'Error: boom' }]);
});

it('never runs more than `concurrency` requests at once', async () => {
  let active = 0;
  let peak = 0;
  const slow: Source = {
    name: 'greenhouse',
    fetchJobs: async (company) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return [job(company)];
    },
  };
  const companies = Array.from({ length: 10 }, (_, i) => ({
    ats: 'greenhouse' as const,
    slug: `c${i}`,
  }));

  await crawl(companies, { greenhouse: slow, ashby: slow, workable: slow }, { concurrency: 3 });

  expect(peak).toBe(3);
});
