import { createSign } from 'node:crypto';
import * as z from 'zod/mini';
import type { FetchFn } from './http.ts';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const ServiceAccountKeySchema = z.object({
  client_email: z.string(),
  private_key: z.string(),
});
export type ServiceAccountKey = z.infer<typeof ServiceAccountKeySchema>;

/** Accepts the key file as raw JSON or base64 of it (handy for .env and SSM). */
export function parseServiceAccountKey(value: string): ServiceAccountKey {
  const json = value.trim().startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8');
  return ServiceAccountKeySchema.parse(JSON.parse(json));
}

const b64url = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** Returns a function that gives a valid access token, refreshing it ~1 min before expiry. */
export function googleTokenProvider(key: ServiceAccountKey, scope: string, fetchFn: FetchFn = fetch) {
  let cached: { token: string; expiresAt: number } | undefined;

  return async function getToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.expiresAt - 60 > now) return cached.token;

    const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
      iss: key.client_email,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');

    const res = await fetchFn(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Google token error ${res.status}: ${await res.text()}`);
    const body = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await res.json());

    cached = { token: body.access_token, expiresAt: now + body.expires_in };
    return cached.token;
  };
}
