import type { Job } from '../src/ats/types.ts';

export const makeJob = (overrides: Partial<Job> = {}): Job => ({
  source: 'greenhouse',
  company: 'acme',
  id: '1',
  title: 'Backend Engineer',
  location: 'London',
  url: 'https://jobs.example/1',
  description: '',
  education: '',
  updatedAt: new Date(),
  ...overrides,
});
