import { AUTH_PROFILES } from '@config/auth-profile';
import { env } from '@config/env';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { expect, test } from '@fixtures';

/**
 * A bulk-mail result belongs to its sender. GET /v2/sentMail/bulkMail/status/{fromAddress} looks the
 * result up by the path's address, not the token's, and removes it once read
 * (SentMailServiceImpl.getBulkMailStatus ~2796-2829), so another user can read it and the real sender
 * then gets 404 (#13417). One bulk mail from the 1st QA account to the 2nd per run.
 */
const K = AUTH_PROFILES.kpost;
const SENDER = K.principals.find((p) => p.key === 'personal')!;
const RECEIVER = K.principals.find((p) => p.key === 'victim')!;
const STRANGER = K.principals.find((p) => p.key === 'personal-3')!;
const BASE = `${(env.KMAIL_API_BASE_URL ?? '').replace(/\/+$/, '')}${env.KMAIL_PATH_PREFIX ?? ''}`;

test.describe(
  "KMail · a bulk-mail result is only the sender's to read @api @kmail-api @kmail @security",
  {
    tag: ['@api', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(!env.KMAIL_API_BASE_URL, 'the KMail BASE_URL is not configured');

    test("another user cannot read (and so consume) the sender's bulk-mail result", async ({
      endpoints,
      request,
    }) => {
      const tokenOf = (p: typeof SENDER) => endpoints.tokens.tokenFor(p, K);
      const statusUrl = `${BASE}/sentMail/bulkMail/status/${encodeURIComponent(SENDER.username)}`;
      const status = async (who: typeof SENDER) =>
        request.get(statusUrl, {
          headers: { Authorization: `Bearer ${await tokenOf(who)}` },
          failOnStatusCode: false,
        });

      const sent = await request.post(`${BASE}/sentMail/postBulkMail`, {
        headers: { Authorization: `Bearer ${await tokenOf(SENDER)}` },
        data: {
          toAddressList: [RECEIVER.username],
          kmailSubject: 'QA Bench Bulk Mail — safe to ignore',
          kmailContent: 'QA bench bulk mail body — safe to ignore.',
          priority: 0,
          kmailType: 13,
          attachmentUuid: [],
        },
        failOnStatusCode: false,
      });
      expect(sent.status(), 'BLOCKED: needs a bulk mail to look up').toBeLessThan(300);

      // Owner control: while processing, the sender's own read answers 202 and keeps the entry.
      await expect
        .poll(async () => (await status(SENDER)).status(), {
          message: 'owner control: the sender can read its own bulk-mail status',
          timeout: 30_000,
        })
        .toBeLessThan(300);

      // Let it complete, so a read would hand over (and remove) the finished result.
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      const stranger = await status(STRANGER);
      expect
        .soft(
          stranger.status(),
          "the 3rd QA account must not get the 1st account's bulk-mail result (#13417)",
        )
        .toBeGreaterThanOrEqual(400);
    });
  },
);
