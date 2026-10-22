import * as z from 'zod/mini';
import raw from '../config/profile.json' with { type: 'json' };

export const lower = z.array(z.string().check(z.minLength(1)));

export const ProfileSchema = z.object({
  titleKeywords: lower,
  excludeTitleKeywords: lower,
  skillKeywords: lower,
  locations: lower,
  minScore: z.number(),
});

export type Profile = z.infer<typeof ProfileSchema>;

export const profile: Profile = ProfileSchema.parse(raw);
