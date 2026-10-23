import { createVerify, generateKeyPairSync } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { googleTokenProvider, parseServiceAccountKey, rotatingTokenProvider } from '../src/lib/google-auth.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const key = {
  client_email: 'bot@project.iam.gserviceaccount.com',
  private_key: privateKey,
};

const makeKey = (email: string) => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return JSON.stringify({ client_email: email, private_key: privateKey });
};

const tokenResponse = (token: string) => new Response(JSON.stringify({ access_token: token, expires_in: 3600 }));

it('parses the key from raw JSON and from base64', () => {
  const json = JSON.stringify(key);
  expect(parseServiceAccountKey(json)).toEqual(key);
  expect(parseServiceAccountKey(Buffer.from(json).toString('base64'))).toEqual(key);
});

it('sends a correctly signed JWT and caches the token', async () => {
  const fetchFn = vi.fn<typeof fetch>(async () => Response.json({ access_token: 'tok', expires_in: 3600 }));
  const getToken = googleTokenProvider(key, 'scope-x', fetchFn);

  expect(await getToken()).toBe('tok');
  expect(await getToken()).toBe('tok');
  expect(fetchFn).toHaveBeenCalledTimes(1); // second call served from cache

  const body = fetchFn.mock.calls[0]?.[1]?.body as URLSearchParams;
  const [header, payload, signature] = (body.get('assertion') ?? '').split('.');
  const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString());

  expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
  expect(claims).toMatchObject({
    iss: key.client_email,
    scope: 'scope-x',
    aud: 'https://oauth2.googleapis.com/token',
  });
  expect(claims.exp - claims.iat).toBe(3600);
  const valid = createVerify('RSA-SHA256')
    .update(`${header}.${payload}`)
    .verify(publicKey, signature ?? '', 'base64url');
  expect(valid).toBe(true);
});

it('reuses the token while the key is unchanged and refetches after rotation', async () => {
  const keyA = makeKey('a@x.iam.gserviceaccount.com');
  const keyB = makeKey('b@x.iam.gserviceaccount.com');
  let currentKey = keyA;

  const fetchFn = vi
    .fn()
    .mockResolvedValueOnce(tokenResponse('token-a'))
    .mockResolvedValueOnce(tokenResponse('token-b'));

  const getToken = rotatingTokenProvider(async () => currentKey, 'scope', fetchFn);

  expect(await getToken()).toBe('token-a');
  expect(await getToken()).toBe('token-a');
  expect(fetchFn).toHaveBeenCalledTimes(1);

  currentKey = keyB; // rotation
  expect(await getToken()).toBe('token-b');
  expect(fetchFn).toHaveBeenCalledTimes(2);
});
