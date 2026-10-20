export interface Job {
  source: "greenhouse" | "ashby" | "workable";
  company: string;
  id: string;
  title: string;
  location: string;
  url: string;
  description: string;
  education: string;
  updatedAt: Date;
}

export interface Source {
  name: Job["source"];
  fetchJobs(company: string, signal?: AbortSignal): Promise<Job[]>;
}
