import * as z from 'zod/mini';
import { htmlToText } from '../lib/html.ts';
import { type FetchFn, getJson } from '../lib/http.ts';
import type { Job, Source } from './types.ts';

const BASE = 'https://boards-api.greenhouse.io/v1/boards';

const ResponseSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      updated_at: z.string(),
      absolute_url: z.string(),
      content: z.optional(z.string()),
      location: z.object({ name: z.string() }),
    }),
  ),
});

export function greenhouse(fetchFn: FetchFn = fetch): Source {
  return {
    name: 'greenhouse',
    async fetchJobs(board, signal) {
      const url = `${BASE}/${encodeURIComponent(board)}/jobs?content=true`;

      const data = ResponseSchema.parse(await getJson(url, { fetchFn, signal }));
      return data.jobs.map(
        (j): Job => ({
          source: 'greenhouse',
          company: board,
          id: String(j.id),
          title: j.title,
          location: j.location.name,
          url: j.absolute_url,
          description: htmlToText(j.content ?? ''),
          updatedAt: new Date(j.updated_at),
        }),
      );
    },
  };
}
