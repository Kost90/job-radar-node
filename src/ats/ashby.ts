import * as z from 'zod/mini';
import { type FetchFn, getJson } from '../lib/http.ts';
import type { Job, Source } from './types.ts';

const BASE = 'https://api.ashbyhq.com/posting-api/job-board';

const ResponseSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      publishedAt: z.string(),
      jobUrl: z.string(),
      education: z.optional(z.string()),
      location: z.string(),
      isListed: z.optional(z.boolean()),
      descriptionPlain: z.optional(z.nullable(z.string())),
    }),
  ),
});

export function ashby(fetchFn: FetchFn = fetch): Source {
  return {
    name: 'ashby',
    async fetchJobs(board, signal) {
      const url = `${BASE}/${encodeURIComponent(board)}`;

      const data = ResponseSchema.parse(await getJson(url, { fetchFn, signal }));
      return data.jobs
        .filter((j) => j.isListed !== false) // unlisted = direct link only
        .map(
          (j): Job => ({
            source: 'ashby',
            company: board,
            id: String(j.id) ?? j.jobUrl,
            title: j.title,
            location: j.location,
            url: j.jobUrl,
            description: j.descriptionPlain ?? '',
            education: j.education ?? '',
            updatedAt: new Date(j.publishedAt),
          }),
        );
    },
  };
}
