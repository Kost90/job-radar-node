import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { greenhouse } from "../src/ats/greenhouse.ts";
import { HttpError } from "../src/lib/http.ts";

const fixture = await readFile(
  new URL("./fixtures/greenhouse.sample.json", import.meta.url),
  "utf8",
);

describe("greenhouse", () => {
  it("maps jobs and turns HTML into text", async () => {
    const fetchFn = vi.fn(async () => new Response(fixture));
    const jobs = await greenhouse(fetchFn).fetchJobs("stripe");

    expect(fetchFn).toHaveBeenCalledWith(
      "https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true",
      expect.anything(),
    );
    expect(jobs).toHaveLength(729);
    expect(jobs[0]).toMatchObject({
      id: "8172487",
      title: "Abuse Investigator",
      location: "Dublin",
    });
  });

  it("throws HttpError on 404", async () => {
    const fetchFn = vi.fn(
      async () => new Response("not found", { status: 404 }),
    );
    await expect(greenhouse(fetchFn).fetchJobs("nope")).rejects.toBeInstanceOf(
      HttpError,
    );
  });
});
