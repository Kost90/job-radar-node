import { ashby } from './ats/ashby.ts';
import { greenhouse } from './ats/greenhouse.ts';
import { workable } from './ats/workable.ts';
import { companies } from './config.ts';
import { googleTokenProvider, parseServiceAccountKey } from './lib/google-auth.ts';
import { runPipeline } from './pipeline.ts';
import { profile } from './profile.ts';
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

const summary = await runPipeline(
  {
    companies,
    sources: { greenhouse: greenhouse(), ashby: ashby(), workable: workable() },
    profile,
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
