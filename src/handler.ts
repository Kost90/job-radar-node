import { Logger } from '@aws-lambda-powertools/logger';
import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { Context } from 'aws-lambda';
import * as z from 'zod/mini';
import { companies, sources } from './config.ts';
import { parseServiceAccountKey, rotatingTokenProvider } from './lib/google-auth.ts';
import { runPipeline } from './pipeline.ts';
import { profile } from './profile.ts';
import { dynamoSeenStore } from './seen.ts';
import { sheetsSink } from './sheets.ts';

// ---- init phase: runs once per execution environment (cold start), reused by warm invocations ----

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

const env = z
  .object({
    TABLE_NAME: z.string(),
    GOOGLE_KEY_PARAM: z.string(),
    SPREADSHEET_ID: z.string(),
    SHEET_NAME: z._default(z.string(), 'Jobs'),
  })
  .parse(process.env);

const logger = new Logger({ serviceName: 'job-radar' });

const seen = dynamoSeenStore({
  client: new DynamoDBClient({}),
  tableName: env.TABLE_NAME,
});

// Powertools caches the value for 15 minutes: warm invocations skip SSM, a rotated key arrives without a redeploy
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

// ---- invoke phase ----

const EventSchema = z.object({ dryRun: z.optional(z.boolean()) });

export const handler = async (event: unknown, context: Context) => {
  logger.addContext(context);
  const { dryRun = false } = EventSchema.parse(event ?? {});

  const summary = await runPipeline({ companies, sources, profile, seen, sink }, { dryRun });

  for (const e of summary.errors) {
    logger.warn('company failed', {
      ats: e.company.ats,
      slug: e.company.slug,
      error: e.message,
    });
  }

  const { fetched, matched, written } = summary;

  logger.info('run finished', {
    fetched,
    matched,
    written,
    dryRun,
    failed: summary.errors.length,
  });

  if (summary.errors.length > 0 && summary.errors.length === companies.length) {
    throw new Error('Every company failed, see the warnings above');
  }

  return {
    fetched,
    matched,
    written,
    dryRun,
    top: summary.top.map(({ job, score }) => ({
      score,
      company: job.company,
      title: job.title,
      url: job.url,
    })),
  };
};
