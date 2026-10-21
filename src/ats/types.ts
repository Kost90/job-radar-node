export type AtsName = 'greenhouse' | 'ashby' | 'workable';
export interface Job {
  source: AtsName;
  /** in workable use "name" filed outside from jobs array, ashby doesn't have this field, so use from url*/
  company: string;
  /** exist only in greenhouse and ashby*/
  id: string;
  title: string;
  location: string;
  url: string;
  /** exist only in greenhouse and ashby */
  description: string;
  education: string;
  /** use "publishedAt" for ashby and "published_on" for workable */
  updatedAt: Date;
}

export interface Source {
  name: AtsName;
  fetchJobs(company: string, signal?: AbortSignal): Promise<Job[]>;
}
