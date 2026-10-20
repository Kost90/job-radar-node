import { greenhouse } from "./ats/greenhouse";

const board = process.argv[2] ?? "stripe";

const jobs = await greenhouse().fetchJobs(board);

console.table(
  jobs
    .slice(0, 15)
    .map((j) => ({
      title: j.title,
      location: j.location,
      url: j.url,
      education: j.education,
    })),
);
console.log(`${jobs.length} jobs from greenhouse/${board}`);
console.log(
  `\nFirst description:\n${jobs[0]?.description.slice(0, 300) ?? "(none)"}`,
);
