import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  type DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { expect, it, vi } from 'vitest';
import { dynamoSeenStore, jobKey } from '../src/seen.ts';
import type { ScoredJob } from '../src/sheets.ts';
import { makeJob } from './helpers.ts';

const scored = (id: string): ScoredJob => ({
  job: makeJob({ id }),
  score: 50,
  match: true,
  reasons: [],
});

/** A fake client that behaves like a table: a second PutItem for the same key fails its condition. */
const fakeTable = (failOn?: string) => {
  const keys = new Set<string>();
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof PutItemCommand) {
      const key = command.input.Item?.job_key?.S ?? '';
      if (key === failOn) throw new Error('ProvisionedThroughputExceededException');
      if (keys.has(key))
        throw new ConditionalCheckFailedException({
          message: 'exists',
          $metadata: {},
        });
      keys.add(key);
    } else if (command instanceof DeleteItemCommand) {
      keys.delete(command.input.Key?.job_key?.S ?? '');
    }
    return {};
  });
  return {
    client: { send } as unknown as Pick<DynamoDBClient, 'send'>,
    send,
    keys,
  };
};

const now = () => new Date('2026-10-22T07:00:00Z');

it('writes a conditional item with a TTL and returns only new jobs', async () => {
  const table = fakeTable();
  const store = dynamoSeenStore({
    client: table.client,
    tableName: 'seen',
    now,
  });

  expect((await store.claim([scored('1'), scored('2')])).map((m) => m.job.id)).toEqual(['1', '2']);
  expect((await store.claim([scored('2'), scored('3')])).map((m) => m.job.id)).toEqual(['3']);

  const put = table.send.mock.calls[0]?.[0] as PutItemCommand;
  expect(put.input).toMatchObject({
    TableName: 'seen',
    ConditionExpression: 'attribute_not_exists(job_key)',
    Item: {
      job_key: { S: 'greenhouse#acme#1' },
      first_seen: { S: '2026-10-22T07:00:00.000Z' },
      expires_at: { N: String(Date.parse('2026-12-01T07:00:00Z') / 1000) }, // + 40 days
    },
  });
});

it('on an unexpected error releases what it claimed and throws', async () => {
  const table = fakeTable(jobKey(makeJob({ id: 'bad' })));
  const store = dynamoSeenStore({
    client: table.client,
    tableName: 'seen',
    now,
  });

  await expect(store.claim([scored('1'), scored('bad')])).rejects.toThrow('1 of 2 writes failed');
  expect(table.keys.size).toBe(0);
});
