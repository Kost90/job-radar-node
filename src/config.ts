import * as z from 'zod/mini';
import raw from '../config/companies.json' with { type: 'json' };
import { ashby } from './ats/ashby';
import { greenhouse } from './ats/greenhouse';
import { workable } from './ats/workable';

export const CompanySchema = z.object({
  ats: z.enum(['greenhouse', 'ashby', 'workable']),
  slug: z.string().check(z.minLength(1)),
});

export type Company = z.infer<typeof CompanySchema>;

// validated once at startup: a typo in the config fails fast with a clear error
export const companies: Company[] = z.array(CompanySchema).parse(raw);

// Sources with agregation funcs
export const sources = {
  greenhouse: greenhouse(),
  ashby: ashby(),
  workable: workable(),
};
