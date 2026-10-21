import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { workable } from '../src/ats/workable.ts';

const fixture = await readFile(new URL('./fixtures/workable.json', import.meta.url), 'utf8');

it('builds location from parts and falls back to Remote', async () => {
  const jobs = await workable(vi.fn(async () => new Response(fixture))).fetchJobs('example');

  expect(jobs.map((j) => j.location)).toEqual(['Berlin, Germany']);
  expect(jobs[0]).toMatchObject({
    id: 'AB12CD34EF',
    description: 'We use TypeScript & AWS.',
  });
});
