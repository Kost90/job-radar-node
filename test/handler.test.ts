import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ConditionalCheckFailedException, DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import type { Context } from 'aws-lambda';
import { beforeAll, expect, it, vi } from 'vitest';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

// SSM is mocked at the module level: the handler reads the secret during import (top-level await)
const getParameter = vi.hoisted(() => vi.fn());
vi.mock('@aws-lambda-powertools/parameters/ssm', () => ({ getParameter }));

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
const fetchMock = vi.fn<typeof fetch>(async (input) => {
  const url = String(input);
  if (url.includes('greenhouse.io')) return new Response(fixture('greenhouse'));
  if (url.includes('ashbyhq.com')) return new Response(fixture('ashby'));
  if (url.includes('workable.com')) return new Response(fixture('workable'));
  if (url.startsWith('https://oauth2.googleapis.com/token'))
    return Response.json({ access_token: 't', expires_in: 3600 });
  if (url.startsWith('https://sheets.googleapis.com/')) return Response.json({});
  return new Response('unexpected', { status: 500 });
});

const table = new Set<string>();
const send = vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async (command: unknown) => {
  if (command instanceof PutItemCommand) {
    const key = command.input.Item?.job_key?.S ?? '';
    if (table.has(key))
      throw new ConditionalCheckFailedException({
        message: 'exists',
        $metadata: {},
      });
    table.add(key);
  }
  return {};
});

const sheetsAppends = () => fetchMock.mock.calls.filter(([u]) => String(u).includes(':append')).length;
let handler: typeof import('../src/handler.ts').handler;
let initCalls: unknown[][] = [];
const context = { functionName: 'job-radar', awsRequestId: 'r1' } as Context;

beforeAll(async () => {
  vi.stubEnv('TABLE_NAME', 'job-radar-seen');
  vi.stubEnv('GOOGLE_KEY_PARAM', '/job-radar/google-key');
  vi.stubEnv('SPREADSHEET_ID', 'SHEET');
  vi.stubGlobal('fetch', fetchMock);
  getParameter.mockResolvedValue(
    JSON.stringify({
      client_email: 'bot@p.iam.gserviceaccount.com',
      private_key: privateKey,
    }),
  );
  ({ handler } = await import('../src/handler.ts'));
  initCalls = [...getParameter.mock.calls]; // Vitest 5 clears mock calls before every test, so keep them
});

it('reads the secret once during init', () => {
  expect(initCalls).toEqual([['/job-radar/google-key', { decrypt: true, maxAge: 900 }]]);
});

it('dry run writes nothing', async () => {
  const result = await handler({ dryRun: true }, context);
  expect(result).toMatchObject({ dryRun: true, written: 0 });
  expect(result.fetched).toBeGreaterThan(0);
  expect(send).not.toHaveBeenCalled();
  expect(sheetsAppends()).toBe(0);
});

it('rejects a malformed event', async () => {
  await expect(handler({ dryRun: 'yes' }, context)).rejects.toThrow();
});
