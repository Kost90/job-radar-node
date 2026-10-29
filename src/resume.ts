import * as z from 'zod/mini';

// The resume as structured data. Only what matters for matching a job:
// no name, email or phone.
const list = z.array(z.string());

export const ResumeSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  yearsOfExperience: z.number(),
  location: z.string(),
  workAuthorization: z.optional(z.string()),
  languages: z.array(z.object({ language: z.string(), level: z.string() })),
  skills: z.record(z.string(), list),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      start: z.string(),
      end: z.nullable(z.string()),
      location: z.optional(z.string()),
      stack: list,
      highlights: list,
    }),
  ),
  education: z.optional(
    z.array(z.object({ degree: z.string(), institution: z.string(), year: z.optional(z.string()) })),
  ),
  projects: z.optional(list),
  certifications: z.optional(list),
  preferences: z.optional(
    z.object({
      roles: list,
      seniority: z.optional(z.string()),
      remote: z.optional(z.boolean()),
      locations: z.optional(list),
    }),
  ),
});

export type Resume = z.infer<typeof ResumeSchema>;

/** Fails loudly on a typo in the JSON: better at cold start than as 50 confusing LLM answers. */
export function parseResume(raw: string): Resume {
  return ResumeSchema.parse(JSON.parse(raw));
}

/** Minified JSON: the same facts in fewer tokens than pretty-printed. */
export const resumeForPrompt = (resume: Resume) => JSON.stringify(resume);
