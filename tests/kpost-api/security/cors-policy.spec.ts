import { env } from '@config/env';
import { expect, test } from '@fixtures';

/**
 * CORS: a website that is not KPost must never be allowed to call the APIs with the user's
 * credentials. Today every API answers `Access-Control-Allow-Origin: *` without credentials, which
 * is safe for bearer-token auth (another site cannot read the token). This fails if an API starts to
 * reflect an arbitrary origin or to allow credentials for it. Read-only: preflight requests only.
 */
const HOSTS = [
  ['KPost API', env.KPOST_API_BASE_URL ?? env.API_BASE_URL, '/v2/profile/getlanguages/'],
  ['KMail API', env.KMAIL_API_BASE_URL, '/v2/common/selectedContactMails/'],
  ['Admin API', env.ADMIN_API_BASE_URL, '/'],
] as const;
const FOREIGN = ['https://evil.example', 'null'];

test.describe(
  'CORS · no foreign website gets credentialed access @api @kpost-api @security',
  {
    tag: ['@api', '@platform', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    for (const [name, base, path] of HOSTS) {
      test(`${name}: a foreign origin is not trusted with credentials`, async ({ request }) => {
        test.skip(!base, `the ${name} BASE_URL is not configured`);
        const problems: string[] = [];
        for (const origin of FOREIGN) {
          const res = await request.fetch(`${base!.replace(/\/+$/, '')}${path}`, {
            method: 'OPTIONS',
            headers: {
              Origin: origin,
              'Access-Control-Request-Method': 'POST',
              'Access-Control-Request-Headers': 'authorization,content-type',
            },
            failOnStatusCode: false,
            timeout: 15_000,
          });
          const allowOrigin = res.headers()['access-control-allow-origin'];
          const allowCredentials = res.headers()['access-control-allow-credentials'];
          if (allowOrigin === origin)
            problems.push(`${origin}: the origin is reflected (Allow-Origin: ${allowOrigin})`);
          if (allowCredentials === 'true' && allowOrigin !== undefined)
            problems.push(
              `${origin}: credentials allowed (Allow-Credentials: true, Allow-Origin: ${allowOrigin})`,
            );
        }
        expect(problems, `${name} must not trust a foreign origin`).toEqual([]);
      });
    }
  },
);
