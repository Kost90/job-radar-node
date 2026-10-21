import * as z from 'zod/mini';
import { htmlToText } from '../lib/html.ts';
import { type FetchFn, getJson } from '../lib/http.ts';
import type { Job, Source } from './types.ts';

const BASE = 'https://www.workable.com/api/accounts';

const ResponseSchema = z.object({
  jobs: z.array(
    z.object({
      shortcode: z.string(),
      title: z.string(),
      published_on: z.string(),
      url: z.string(),
      education: z.optional(z.string()),
      city: z.optional(z.nullable(z.string())),
      state: z.optional(z.nullable(z.string())),
      country: z.optional(z.nullable(z.string())),
      telecommuting: z.optional(z.nullable(z.boolean())),
      description: z.optional(z.string()),
    }),
  ),
});

export function workable(fetchFn: FetchFn = fetch): Source {
  return {
    name: 'workable',
    async fetchJobs(board, signal) {
      const url = `${BASE}/${encodeURIComponent(board)}?details=true`;

      const data = ResponseSchema.parse(await getJson(url, { fetchFn, signal }));
      return data.jobs.map((j): Job => {
        const place = [j.city, j.state, j.country].filter(Boolean).join(', ');

        return {
          source: 'workable',
          company: board,
          id: String(j.shortcode),
          title: j.title,
          location: place || (j.telecommuting ? 'Remote' : ''),
          url: j.url,
          description: htmlToText(j.description ?? ''),
          education: j.education ?? '',
          updatedAt: new Date(j.published_on ?? 0),
        };
      });
    },
  };
}
