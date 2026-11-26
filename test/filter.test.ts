import { describe, expect, it } from 'vitest';
import { matchJob } from '../src/filter.ts';
import { type Profile, profile as realProfile } from '../src/profile.ts';
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

  describe('whole-word keywords', () => {
    const p: Profile = {
      ...profile,
      excludeTitleKeywords: ['intern', 'ios'],
      skillKeywords: ['sql', 'typescript'],
      minScore: 50,
    };
    const desc = 'We use TypeScript and SQL.';

    it.each([
      ['Backend Engineer, Internal Tools', true],
      ['Backend Engineer Intern', false],
      ['Intern, Backend Engineer', false],
      ['Backend Engineer (Intern)', false],
      ['Backend Engineer, Radios', true],
      ['Backend Engineer iOS', false],
    ] as const)('exclude: %s -> match=%s', (title, expected) => {
      expect(matchJob(makeJob({ title, description: desc }), p).match).toBe(expected);
    });

    it.each([
      ['Senior Node.js Developer', true],
      // An unescaped "." would match any character here.
      ['Senior Nodexjs Developer', false],
    ] as const)('dot keyword: %s -> match=%s', (title, expected) => {
      const withDot = { ...p, titleKeywords: ['node.js'] };
      expect(matchJob(makeJob({ title, description: desc }), withDot).match).toBe(expected);
    });

    it('does not match sql inside nosql', () => {
      expect(matchJob(makeJob({ description: 'We use NoSQL and Go.' }), p).match).toBe(false);
    });

    it('does not match uk inside another word', () => {
      // "milwaukee" contains "uk" as a substring.
      expect(matchJob(makeJob({ location: 'Milwaukee, WI', description: desc }), p).match).toBe(false);
    });
  });

  describe('real profile config', () => {
    const desc = 'Build REST APIs in TypeScript with ReactJS and NextJS.';

    it.each([
      'Backend Engineer Internship',
      'Backend Engineer Interns',
      'Software Engineer, Data Engineering',
      'Software Engineer, QA Engineering',
    ])('excludes %s', (title) => {
      expect(matchJob(makeJob({ title, description: desc }), realProfile).match).toBe(false);
    });

    it('matches plural and glued skill variants', () => {
      const result = matchJob(makeJob({ title: 'Backend Engineer', description: desc }), realProfile);
      expect(result.reasons).toContain('skills: typescript, reactjs, nextjs, rest apis');
      expect(result.match).toBe(true);
    });

    it('counts React.js as one skill', () => {
      const result = matchJob(makeJob({ title: 'Backend Engineer', description: 'TypeScript, React.js' }), realProfile);
      expect(result).toMatchObject({ score: 60, match: false });
      expect(result.reasons).toContain('skills: typescript, react');
    });
  });
});
