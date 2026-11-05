import type { APIRequestContext } from '@playwright/test';
import { env } from '@config/env';
import { expect, test } from '@fixtures';

/**
 * Sending a mail needs a login. /v2/translator/** is public (SecurityConfiguration.java:126) and
 * TranslatorController.postMail sends the body as is, fromAddress included, so anyone can send a
 * KMail as any user (#13416, proved once live on 2026-11-02 between two QA accounts). Zero writes
 * here: a body that cannot be parsed shows whether the request got past the security filter (400)
 * or was refused for having no token (401), and the normal send path is the control.
 */
const BASE = `${(env.KMAIL_API_BASE_URL ?? '').replace(/\/+$/, '')}${env.KMAIL_PATH_PREFIX ?? ''}`;

const unsignedPost = async (request: APIRequestContext, path: string): Promise<number> =>
  (
    await request.post(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from('{not json'),
      failOnStatusCode: false,
    })
  ).status();

test.describe(
  'KMail · a mail can only be sent by a signed-in user @api @kmail-api @kmail @security',
  {
    tag: ['@api', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(!env.KMAIL_API_BASE_URL, 'the KMail BASE_URL is not configured');

    test('the translator send path refuses a request with no token, as the normal send does', async ({
      request,
    }) => {
      expect(
        await unsignedPost(request, '/sentMail/postMail/'),
        'control: the normal send path refuses no token',
      ).toBe(401);
      expect
        .soft(
          await unsignedPost(request, '/translator/postMail'),
          "/v2/translator/postMail must refuse a request with no token (#13416): today it is public and sends as the body's fromAddress",
        )
        .toBe(401);
    });
  },
);
