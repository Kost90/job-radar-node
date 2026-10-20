import { greenhouse } from "./ats/greenhouse.ts";

// Runs once per execution environment (cold start), reused by warm invocations.
const source = greenhouse();

export const handler = async () => {
  const jobs = await source.fetchJobs("stripe");
  console.log(JSON.stringify({ msg: "fetched", count: jobs.length }));
  return { count: jobs.length };
};
