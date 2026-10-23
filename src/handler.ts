import { companies, sources } from './config.ts';
import { crawl } from './crawl.ts';

export const handler = async () => {
  const { jobs, errors } = await crawl(companies, sources);
  console.log(JSON.stringify({ msg: 'crawl finished', jobs: jobs.length, errors }));
  return { jobs: jobs.length, errors: errors.length };
};
