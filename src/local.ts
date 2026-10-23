import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { companies, sources } from './config.ts';
import { googleTokenProvider, parseServiceAccountKey } from './lib/google-auth.ts';
import { runPipeline } from './pipeline.ts';
import { profile } from './profile.ts';
import { dynamoSeenStore, memorySeenStore } from './seen.ts';
import { sheetsSink } from './sheets.ts';

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name} (see .env.example)`);
  return value;
};

const dryRun = process.argv.includes('--dry-run');
const key = parseServiceAccountKey(env('GOOGLE_SA_KEY'));
const sink = sheetsSink({
  spreadsheetId: env('SPREADSHEET_ID'),
  sheetName: process.env.SHEET_NAME ?? 'Jobs',
  getToken: googleTokenProvider(key, 'https://www.googleapis.com/auth/spreadsheets'),
});

const tableName = env('TABLE_NAME');
const environment = env('ENVIRONMENT');

const seen =
  environment !== 'development' && tableName
    ? dynamoSeenStore({ client: new DynamoDBClient({}), tableName })
    : memorySeenStore(dryRun ? [] : await sink.existingIds(), (job) => job.id);

const summary = await runPipeline(
  {
    companies,
    sources,
    profile,
    seen,
    sink,
  },
  { dryRun },
);

console.table(
  summary.top.map(({ job, score }) => ({
    score,
    company: job.company,
    title: job.title,
    location: job.location,
  })),
);
console.log(
  `fetched ${summary.fetched}, matched ${summary.matched}, written ${summary.written}${dryRun ? ' (dry run)' : ''}`,
);
for (const e of summary.errors) console.error(`FAILED ${e.company.ats}/${e.company.slug}: ${e.message}`);
