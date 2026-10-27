// Prompt playground: crawl (dry run), score the top 5 with the LLM, print the verdicts and the cost.
// Writes nothing anywhere.   npm run try:llm               -> scores only
//                            npm run try:llm -- --telegram -> also sends the summary to your chat
import { readFile } from 'node:fs/promises';
import { ashby } from './ats/ashby.ts';
import { greenhouse } from './ats/greenhouse.ts';
import { workable } from './ats/workable.ts';
import { companies } from './config.ts';
import { anthropic, costUsd } from './llm.ts';
import { formatSummary, telegram } from './notify.ts';
import { runPipeline } from './pipeline.ts';
import { profile } from './profile.ts';
import { parseResume, resumeForPrompt } from './resume.ts';
import { aiScorer } from './scoring.ts';
import { memorySeenStore } from './seen.ts';

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name} (see .env.example)`);
  return value;
};

const apiKey = env('ANTHROPIC_API_KEY');
const resumeText = resumeForPrompt(parseResume(await readFile(env('RESUME_FILE'), 'utf8')));
const llm = anthropic({ apiKey: async () => apiKey, model: process.env.LLM_MODEL ?? 'claude-haiku-5-5' });

const { top } = await runPipeline(
  {
    companies,
    sources: { greenhouse: greenhouse(), ashby: ashby(), workable: workable() },
    profile,
    seen: memorySeenStore([], (j) => j.url),
    sink: {
      append: async () => {},
      existingIds: (): Promise<Set<string>> => {
        throw new Error('Function not implemented.');
      },
    },
  },
  { dryRun: true },
);

const r = await aiScorer({ llm, resume: async () => resumeText }).score(top);
for (const { job, score, ai } of r.jobs) {
  console.log(`\n[kw ${score} | AI ${ai?.score ?? '-'} | ${ai?.recommendation ?? '-'}] ${job.title} — ${job.company}`);
  console.log(job.url);
  if (ai) console.log(`  advice: ${ai.advice}\n  gaps:   ${ai.gaps.join(' | ') || '-'}`);
}
for (const f of r.failed) console.error(`FAILED ${f.url}: ${f.error}`);

if (process.argv.includes('--telegram')) {
  const bot = telegram({ token: async () => env('TELEGRAM_BOT_TOKEN'), chatId: async () => env('TELEGRAM_CHAT_ID') });
  await bot.send(formatSummary(r.jobs));
  console.log('\nsent to Telegram');
}

const { inputTokens, outputTokens } = r.usage;
console.log(
  `\ntokens: ${inputTokens} in / ${outputTokens} out, ~$${costUsd(r.usage).toFixed(4)} ` +
    `(~${Math.round(inputTokens / Math.max(1, r.scored))} input tokens per job, resume: ${resumeText.length} chars)`,
);
