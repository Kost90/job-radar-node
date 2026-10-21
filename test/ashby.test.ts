import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { ashby } from '../src/ats/ashby.ts';

const fixture = await readFile(new URL('./fixtures/ashby.json', import.meta.url), 'utf8');

it('maps listed Ashby jobs with salary and remote flag', async () => {
  const fetchFn = vi.fn(async () => new Response(fixture));
  const jobs = await ashby(fetchFn).fetchJobs('example');

  expect(jobs).toHaveLength(1); // unlisted job is skipped
  expect(jobs[0]).toMatchObject({
    source: 'ashby',
    title: 'Senior Backend Engineer',
    id: '4f1b2c3d-0000-4000-8000-000000000001',
  });
});
