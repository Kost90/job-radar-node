import { Logger } from '@aws-lambda-powertools/logger';
import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { Context } from 'aws-lambda';
import * as z from 'zod/mini';
import { companies, sources } from './config.ts';
import { parseServiceAccountKey, rotatingTokenProvider } from './lib/google-auth.ts';
import { anthropic, costUsd } from './llm.ts';
import { telegram } from './notify.ts';
import { runPipeline } from './pipeline.ts';
import { profile } from './profile.ts';
import { parseResume, resumeForPrompt } from './resume.ts';
import { aiScorer } from './scoring.ts';
import { dynamoSeenStore } from './seen.ts';
import { sheetsSink } from './sheets.ts';

// ---- init phase: runs once per execution environment (cold start), reused by warm invocations ----

const env = z
  .object({
    TABLE_NAME: z.string(),
    GOOGLE_KEY_PARAM: z.string(),
    SPREADSHEET_ID: z.string(),
    SHEET_NAME: z._default(z.string(), 'Jobs'),
    ANTHROPIC_KEY_PARAM: z.optional(z.string()),
    RESUME_PARAM: z.optional(z.string()),
    TELEGRAM_TOKEN_PARAM: z.optional(z.string()),
    TELEGRAM_CHAT_PARAM: z.optional(z.string()),
    LLM_MODEL: z._default(z.string(), 'claude-haiku-5-5'),
    LLM_MAX_JOBS: z._default(z.string().check(z.regex(/^\d+$/)), '50'),
  })
  .parse(process.env); // a missing variable fails the cold start with a clear message

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const logger = new Logger({ serviceName: 'job-radar' });
const seen = dynamoSeenStore({
  client: new DynamoDBClient({}),
  tableName: env.TABLE_NAME,
});

// Powertools caches the value for 15 minutes: warm invocations skip SSM, a rotated key arrives without a redeploy
const secret = (name: string) => async () => {
  const raw = (await getParameter(name, { decrypt: true, maxAge: 15 * 60 }))?.trim(); // a pasted "\n" breaks API keys
  if (!raw) throw new Error(`SSM parameter ${name} is empty`);
  return raw;
};

const readGoogleKey = async () => {
  const raw = await getParameter(env.GOOGLE_KEY_PARAM, {
    decrypt: true,
    maxAge: 15 * 60,
  });
  if (!raw) throw new Error(`SSM parameter ${env.GOOGLE_KEY_PARAM} is empty`);
  return raw;
};

// fail at init: wrong parameter name, missing permission, or a malformed key
parseServiceAccountKey(await readGoogleKey());

const sink = sheetsSink({
  spreadsheetId: env.SPREADSHEET_ID,
  sheetName: env.SHEET_NAME,
  getToken: rotatingTokenProvider(readGoogleKey, SHEETS_SCOPE),
});

// the resume lives in SSM as JSON; it is validated, then sent to the LLM minified
const resumeParam = env.RESUME_PARAM;
const readResume = resumeParam ? async () => resumeForPrompt(parseResume(await secret(resumeParam)())) : undefined;
const scorer =
  env.ANTHROPIC_KEY_PARAM && readResume
    ? aiScorer({
        llm: anthropic({
          apiKey: secret(env.ANTHROPIC_KEY_PARAM),
          model: env.LLM_MODEL,
        }),
        resume: readResume,
        maxJobs: Number(env.LLM_MAX_JOBS),
      })
    : undefined;

const notifier =
  env.TELEGRAM_TOKEN_PARAM && env.TELEGRAM_CHAT_PARAM
    ? telegram({
        token: secret(env.TELEGRAM_TOKEN_PARAM),
        chatId: secret(env.TELEGRAM_CHAT_PARAM),
      })
    : undefined;

const sheetUrl = `https://docs.google.com/spreadsheets/d/${env.SPREADSHEET_ID}`;

// top-level await: init waits for every configured secret (in parallel), so a wrong name,
// a missing permission or a broken resume JSON fails the cold start, not the middle of a run
const secrets = [env.GOOGLE_KEY_PARAM, env.ANTHROPIC_KEY_PARAM, env.TELEGRAM_TOKEN_PARAM, env.TELEGRAM_CHAT_PARAM];
await Promise.all([
  ...secrets.filter((n): n is string => Boolean(n)).map((n) => secret(n)()),
  readResume?.(), // reads the parameter AND validates it against ResumeSchema
]);

// ---- invoke phase ----

const EventSchema = z.object({ dryRun: z.optional(z.boolean()) });

export const handler = async (event: unknown, context: Context) => {
  logger.addContext(context);
  const { dryRun = false } = EventSchema.parse(event ?? {});

  const summary = await runPipeline(
    { companies, sources, profile, seen, sink, scorer, notifier, sheetUrl },
    { dryRun },
  );

  for (const e of summary.errors) {
    logger.warn('company failed', {
      ats: e.company.ats,
      slug: e.company.slug,
      error: e.message,
    });
  }
  for (const w of summary.warnings) logger.warn(w);
  const { fetched, matched, written, aiScored, notified, usage } = summary;
  // one line per run with the numbers for the README and for CloudWatch Logs Insights
  logger.info('run finished', {
    fetched,
    matched,
    written,
    aiScored,
    notified,
    dryRun,
    failed: summary.errors.length,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    llmCostUsd: Number(costUsd(usage).toFixed(5)),
  });

  if (summary.errors.length > 0 && summary.errors.length === companies.length) {
    throw new Error('Every company failed, see the warnings above'); // marks the invocation as failed
  }
  return {
    fetched,
    matched,
    written,
    dryRun,
    aiScored,
    notified,
    top: summary.top.map(({ job, score, ai }) => ({
      score,
      aiScore: ai?.score,
      recommendation: ai?.recommendation,
      company: job.company,
      title: job.title,
      url: job.url,
    })),
  };
};
