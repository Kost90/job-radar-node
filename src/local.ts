import { companies } from './config';
import { sources } from './constants';
import { crawl } from './crawl';

const started = performance.now();
const { jobs, errors } = await crawl(companies, sources);
const seconds = ((performance.now() - started) / 1000).toFixed(1);

console.table(
  jobs.slice(0, 20).map((j) => ({
    source: j.source,
    company: j.company,
    title: j.title,
    location: j.location,
  })),
);
console.log(
  `${jobs.length} jobs from ${companies.length - errors.length}/${companies.length} companies in ${seconds}s`,
);
for (const e of errors) console.error(`FAILED ${e.company.ats}/${e.company.slug}: ${e.message}`);
