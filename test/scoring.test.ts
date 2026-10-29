import { expect, it, vi } from 'vitest';
import type { Llm } from '../src/llm.ts';
import { aiScorer, jobPrompt, VERDICT_SCHEMA } from '../src/scoring.ts';
import type { ScoredJob } from '../src/sheets.ts';
import { makeJob } from './helpers.ts';

const usage = { inputTokens: 1000, outputTokens: 50 };
const m = (id: string, score: number): ScoredJob => ({
  job: makeJob({ id, title: id, url: `https://j/${id}` }),
  match: true,
  score,
  reasons: [],
});
const verdict = (score: number, recommendation: string) => ({ score, recommendation, advice: 'a', gaps: ['g1'] });

it('scores up to maxJobs, clamps the score, re-sorts by AI score, survives a failure', async () => {
  const answers: Record<string, unknown> = {
    a: verdict(40, 'skip'),
    b: verdict(140, 'apply_as_is'), // out of range
    c: new Error('boom'),
  };
  const json = vi.fn<Llm['json']>(async ({ user }) => {
    const answer = answers[user.match(/Title: (\w)/)?.[1] ?? ''];
    if (answer instanceof Error) throw answer;
    return { data: answer, usage };
  });

  const r = await aiScorer({ llm: { json }, resume: async () => '{"headline":"x"}', maxJobs: 3 }).score([
    m('a', 90),
    m('b', 80),
    m('c', 70),
    m('d', 60),
  ]);

  expect(json).toHaveBeenCalledTimes(3); // d is over the limit
  expect(json.mock.calls[0]?.[0].system).toContain('<resume>\n{"headline":"x"}\n</resume>');
  expect(r.jobs.map((j) => [j.job.id, j.ai?.score ?? j.score])).toEqual([
    ['b', 100], // clamped from 140
    ['c', 70], // failed, keeps keyword score
    ['d', 60], // skipped, keeps keyword score
    ['a', 40], // keyword said 90, the LLM disagreed
  ]);
  expect(r.jobs[0]?.ai).toEqual({ score: 100, recommendation: 'apply_as_is', advice: 'a', gaps: ['g1'] });
  expect(r).toMatchObject({ scored: 2, skipped: 1, usage: { inputTokens: 2000, outputTokens: 100 } });
  expect(r.failed).toEqual([{ url: 'https://j/c', error: 'boom' }]);
});

it('an unknown recommendation is a failed verdict, not a broken row', async () => {
  const json = vi.fn<Llm['json']>(async () => ({ data: verdict(70, 'maybe'), usage }));
  const r = await aiScorer({ llm: { json }, resume: async () => '{}' }).score([m('a', 50)]);
  expect(r.scored).toBe(0);
  expect(r.failed).toHaveLength(1);
});

it('the schema offers exactly three recommendations and no unsupported keywords', () => {
  const props = VERDICT_SCHEMA.properties as Record<string, Record<string, unknown>>;
  expect(props.recommendation?.enum).toEqual(['apply_as_is', 'tailor_resume', 'skip']);
  expect(JSON.stringify(VERDICT_SCHEMA)).not.toMatch(/minimum|maximum|minLength|maxLength/);
});

it('marks the posting as untrusted data and truncates long descriptions', () => {
  const p = jobPrompt(makeJob({ description: 'x'.repeat(100) }), 10);
  expect(p.startsWith('<job>')).toBe(true);
  expect(p.endsWith('</job>')).toBe(true);
  expect(p).toContain(`${'x'.repeat(10)}…`);
  expect(p).not.toContain('x'.repeat(11));
});
