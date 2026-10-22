import { describe, expect, it } from 'vitest';
import { matchJob } from '../src/filter.ts';
import type { Profile } from '../src/profile.ts';
import { makeJob } from './helpers.ts';

const profile: Profile = {
  titleKeywords: ['backend', 'node'],
  excludeTitleKeywords: ['staff', 'intern'],
  skillKeywords: ['typescript', 'aws', 'node'],
  locations: ['london', 'uk'],
  minScore: 70,
};

describe('matchJob', () => {
  it.each([
    // [title, location, description, match, score]
    ['Backend Engineer', 'London', '', false, 0],
    ['Node.js Developer', 'London', 'TypeScript and AWS Node.js react', true, 70],
    ['Staff Backend Engineer', 'London', '', false, 0],
    ['Frontend Engineer', 'London', '', false, 0],
    ['Backend Engineer', 'New York', '', false, 0],
    ['Backend Engineer', 'Remote - Europe', '', false, 0],
  ] as const)('%s / %s -> match=%s', (title, location, description, match, score) => {
    const result = matchJob(makeJob({ title, location, description }), profile);
    expect(result).toMatchObject({ match, score });
  });

  it('respects minScore', () => {
    const strict = { ...profile, minScore: 60 };
    expect(matchJob(makeJob(), strict).match).toBe(false);
  });

  it('explains its decision', () => {
    expect(matchJob(makeJob({ title: 'Intern Backend' }), profile).reasons).toEqual(['excluded: intern']);
  });
});
