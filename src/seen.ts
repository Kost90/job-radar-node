import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  type DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import pLimit from 'p-limit';
import type { Job } from './ats/types.ts';
import type { ScoredJob } from './sheets.ts';

/** Remembers which jobs were already delivered, across runs. */
export interface SeenStore {
  /** Marks jobs as seen and returns only the ones nobody has seen before. */
  claim(jobs: ScoredJob[]): Promise<ScoredJob[]>;
  /** Forgets jobs claimed in this run, e.g. when writing them to the sheet failed. */
  release(jobs: ScoredJob[]): Promise<void>;
}

/** Stable identity of a job: the same posting keeps it even if its title or URL changes. */
export const jobKey = (job: Job) => `${job.source}#${job.company}#${job.id}`;

const DAY_S = 24 * 60 * 60;

export function dynamoSeenStore(opts: {
  client: Pick<DynamoDBClient, 'send'>;
  tableName: string;
  ttlDays?: number;
  concurrency?: number;
  now?: () => Date;
}): SeenStore {
  const { client, tableName, ttlDays = 40, concurrency = 10, now = () => new Date() } = opts;
  const limit = pLimit(concurrency);

  const release = async (jobs: ScoredJob[]) => {
    await Promise.all(
      jobs.map(({ job }) =>
        limit(() =>
          client.send(
            new DeleteItemCommand({
              TableName: tableName,
              Key: { job_key: { S: jobKey(job) } },
            }),
          ),
        ),
      ),
    );
  };

  const claim = async (jobs: ScoredJob[]) => {
    const seenAt = now();
    const expiresAt = Math.floor(seenAt.getTime() / 1000) + ttlDays * DAY_S;

    const settled = await Promise.allSettled(
      jobs.map(({ job }) =>
        limit(() =>
          client.send(
            new PutItemCommand({
              TableName: tableName,
              Item: {
                job_key: { S: jobKey(job) },
                url: { S: job.url },
                first_seen: { S: seenAt.toISOString() },
                expires_at: { N: String(expiresAt) },
              },
              // the write succeeds only if this key is not in the table yet: check and write are one atomic step
              ConditionExpression: 'attribute_not_exists(job_key)',
            }),
          ),
        ),
      ),
    );

    const fresh: ScoredJob[] = [];
    const failures: unknown[] = [];
    for (const [i, outcome] of settled.entries()) {
      const scored = jobs[i];
      if (!scored) continue;
      if (outcome.status === 'fulfilled') fresh.push(scored);
      else if (!(outcome.reason instanceof ConditionalCheckFailedException)) failures.push(outcome.reason);
    }

    if (failures.length > 0) {
      await release(fresh).catch((e) => failures.push(e));
      throw new AggregateError(failures, `DynamoDB: ${failures.length} of ${jobs.length} writes failed`);
    }
    return fresh;
  };

  return { claim, release };
}

/** In-memory store for tests and local runs. */
export function memorySeenStore(initial: Iterable<string> = [], keyOf: (job: Job) => string = jobKey): SeenStore {
  const keys = new Set(initial);
  return {
    async claim(jobs) {
      return jobs.filter(({ job }) => {
        const key = keyOf(job);
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      });
    },
    async release(jobs) {
      for (const { job } of jobs) keys.delete(keyOf(job));
    },
  };
}
