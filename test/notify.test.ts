import { expect, it, vi } from 'vitest';
import { escapeHtml, formatSummary, telegram } from '../src/notify.ts';
import type { Recommendation } from '../src/scoring.ts';
import type { ScoredJob } from '../src/sheets.ts';
import { makeJob } from './helpers.ts';

const m = (recommendation?: Recommendation): ScoredJob => ({
  job: makeJob(),
  match: true,
  score: 50,
  reasons: [],
  ai: recommendation && { score: 70, recommendation, advice: '', gaps: [] },
});

it('counts new jobs by recommendation and links the sheet', () => {
  const text = formatSummary([m('apply_as_is'), m('tailor_resume'), m('tailor_resume'), m('skip'), m()], {
    sheetUrl: 'https://docs.google.com/spreadsheets/d/X?a=1&b=2',
  });
  expect(text).toBe(
    [
      '<b>job-radar</b>: 5 new jobs',
      'apply as is: 1 · tailor resume: 2 · skip: 1',
      'not scored: 1',
      '<a href="https://docs.google.com/spreadsheets/d/X?a=1&amp;b=2">Open the sheet</a>',
    ].join('\n'),
  );
});

it('without the LLM it is just the count', () => {
  expect(formatSummary([m()])).toBe('<b>job-radar</b>: 1 new job\nnot scored: 1');
});

it('escapes &, < and >', () => {
  expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
});

it('does not leak the bot token in errors', async () => {
  const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ok":false}', { status: 401 }));
  const bot = telegram({ token: async () => '123:SECRET', chatId: async () => '42', fetchFn });

  const err = (await bot.send('hi').then(
    () => new Error('expected a failure'),
    (e: unknown) => e as Error,
  )) as Error;
  expect(err.message).toContain('telegram sendMessage');
  expect(err.message).not.toContain('SECRET');
  const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
  expect(body).toEqual({ chat_id: '42', text: 'hi', parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
});
