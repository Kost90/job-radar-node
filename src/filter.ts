import type { Job } from './ats/types.ts';
import type { Profile } from './profile.ts';

export interface MatchResult {
  match: boolean;
  score: number;
  reasons: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_DAYS = 7;

const has = (text: string, words: string[]) => words.filter((w) => text.includes(w.toLowerCase()));

const reject = (reason: string): MatchResult => ({
  match: false,
  score: 0,
  reasons: [reason],
});

/** Pure function: same job + same profile -> same result. Easy to test, no I/O. */
export function matchJob(job: Job, profile: Profile, now: Date = new Date()): MatchResult {
  const ageMs = now.getTime() - job.updatedAt.getTime();
  if (Number.isNaN(ageMs)) return reject('updatedAt: invalid date');
  if (ageMs > MAX_AGE_DAYS * DAY_MS) return reject(`too old: ${Math.floor(ageMs / DAY_MS)}d`);

  const title = job.title.toLowerCase();
  const location = job.location.toLowerCase();
  const description = job.description.toLowerCase();

  const excluded = has(title, profile.excludeTitleKeywords);
  if (excluded.length > 0) return reject(`excluded: ${excluded.join(', ')}`);

  const titleHits = has(title, profile.titleKeywords);
  if (titleHits.length === 0) return reject('title does not match');

  const placeHits = has(location, profile.locations);
  if (placeHits.length === 0) return reject(`location: ${job.location || 'unknown'}`);

  const skills = has(description, profile.skillKeywords);
  if (skills.length === 0) return reject('skills not matched');

  const score = Math.min(100, 40 + 10 * skills.length);
  return {
    match: score >= profile.minScore,
    score,
    reasons: [`title: ${titleHits.join(', ')}`, `skills: ${skills.join(', ')}`],
  };
}
