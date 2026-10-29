import * as z from 'zod/mini';
import { type FetchFn, postJson } from './lib/http.ts';
import type { ScoredJob } from './sheets.ts';

/** Telegram's HTML mode understands only these three entities; everything else is plain text. */
export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');

/** One short message: how many new jobs, how they split by recommendation, a link to the sheet. */
export function formatSummary(jobs: ScoredJob[], opts: { sheetUrl?: string } = {}): string {
  const count = (r: string) => jobs.filter((m) => m.ai?.recommendation === r).length;
  const unscored = jobs.filter((m) => !m.ai).length;

  const lines = [`<b>job-radar</b>: ${jobs.length} new job${jobs.length === 1 ? '' : 's'}`];
  if (jobs.length > unscored) {
    lines.push(
      `apply as is: ${count('apply_as_is')} · tailor resume: ${count('tailor_resume')} · skip: ${count('skip')}`,
    );
  }
  if (unscored > 0) lines.push(`not scored: ${unscored}`);
  if (opts.sheetUrl) lines.push(`<a href="${escapeAttr(opts.sheetUrl)}">Open the sheet</a>`);
  return lines.join('\n');
}

const TelegramResponse = z.object({ ok: z.boolean(), description: z.optional(z.string()) });

export interface Notifier {
  send(text: string): Promise<void>;
}

export function telegram(opts: {
  token: () => Promise<string>;
  chatId: () => Promise<string>;
  fetchFn?: FetchFn;
}): Notifier {
  return {
    async send(text) {
      const url = `https://api.telegram.org/bot${await opts.token()}/sendMessage`;
      const res = TelegramResponse.parse(
        await postJson(
          url,
          { chat_id: await opts.chatId(), text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
          { fetchFn: opts.fetchFn, label: 'telegram sendMessage' },
        ),
      );
      if (!res.ok) throw new Error(`telegram: ${res.description ?? 'not ok'}`);
    },
  };
}
