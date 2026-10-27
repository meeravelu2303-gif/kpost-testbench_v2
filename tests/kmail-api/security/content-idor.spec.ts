import { AUTH_PROFILES } from '@config/auth-profile';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { mailShape } from '@api/definitions/kmail/send.api';
import { expect, test } from '@fixtures';

/**
 * KMail mail-content IDOR: can an outsider read the body of a mail they neither sent nor received,
 * by kmailID alone? The verdict is the response body (it answers 200 either way). The leak is
 * intermittent, so the check is soft: one clean run does not mean fixed.
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // sender
const B = K.principals.find((p) => p.key === 'victim')!; // legitimate recipient
const C = K.principals.find((p) => p.key === 'personal-3')!; // attacker — no relationship to this mail

test.describe(
  'KMail · mail-content IDOR (sentAndInboxMailContent) @api @kmail-api @kmail @security',
  {
    tag: ['@api', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(
      process.env.KMAIL_LIFECYCLE !== 'true',
      'sends a real mail; set KMAIL_LIFECYCLE=true',
    );

    test('an outsider cannot read the body of a mail they did not send or receive', async ({
      endpoints,
    }) => {
      const marker = `QA-SECRET-CONTENT-${Date.now()}`;
      const subject = `QA IDOR content proof ${Date.now()}`;
      let transactionIDs: number[] = [];
      let kmailId: number | undefined;

      try {
        // --- Setup: A sends a real mail to B, with a unique, identifiable body -------------------
        const sent = await endpoints.sendTo(
          'kmail-post-mail',
          {
            body: mailShape({
              toAddress: B.username,
              kmailSubject: subject,
              kmailContent: marker,
            }),
          },
          { label: 'idor:content-send', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(sent.status, 'the mail is sent').toBeLessThan(300);
        const sentJson = sent.json();
        const sentBody = (sentJson.ok ? sentJson.value : {}) as Record<string, unknown>;
        const row = Array.isArray(sentBody.data)
          ? (sentBody.data[0] as Record<string, unknown>)
          : sentBody.data;
        kmailId = Number((row as Record<string, unknown> | undefined)?.kmailID);
        const txns = (row as Record<string, unknown> | undefined)?.kmailTransactionList;
        transactionIDs = Array.isArray(txns)
          ? (txns as Array<Record<string, unknown>>)
              .map((t) => t.transactionID)
              .filter((v): v is number => typeof v === 'number')
          : [];

        test.skip(
          !kmailId || Number.isNaN(kmailId),
          `kmail-post-mail did not return a kmailID (${sent.status})`,
        );

        // Content is stored asynchronously after the send returns; reading at once can find nothing
        // and look safe.
        await new Promise((resolve) => setTimeout(resolve, 5_000));

        // --- Attack: C, who never sent or received this mail, reads it by kmailID alone ----------
        const attack = await endpoints.sendTo(
          'kmail-mail-content',
          {
            body: {
              kmailID: kmailId,
              kmailNumber: 0,
              kmailType: 'Sent',
              selectedContact: B.username,
              groupFlag: false,
            },
          },
          {
            label: 'idor:content-attack',
            auth: { principal: C },
            allowLiveWrite: true,
            allowLiveRead: true,
          },
        );

        const attackJson = attack.json();
        const attackText = attack.bodyText;
        const leaked = attackText.includes(marker) || attackText.includes(subject);

        if (leaked) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kmail-mail-content',
            ruleId: 'IDOR-kmail-mail-content-by-id',
            rule:
              'A KMail message body must only be readable by its sender or receiver — an unrelated ' +
              'account must not be able to read it by kmailID alone.',
            expected: "the outsider's response must not contain the real mail content/subject",
            actual:
              `status=${attack.status}, response body contains the secret marker and/or subject — ` +
              `${C.username} (no relationship to this mail) successfully read a mail ${A.username} sent ` +
              `to ${B.username}, kmailID ${kmailId}`,
            request: { body: { kmailID: kmailId } },
          });
        }

        expect
          .soft(
            leaked,
            `BOLA: an outsider must not read the body of a mail they did not send or receive ` +
              `(kmail-mail-content replied ${attack.status}, ok=${attackJson.ok})`,
          )
          .toBe(false);
      } finally {
        // Cleanup: the owner deletes their own mail so nothing is left dangling.
        if (transactionIDs.length) {
          await endpoints
            .sendTo(
              'kmail-delete',
              { body: { groupFlag: false, transactionIDs } },
              { label: 'idor:content-cleanup', auth: { principal: A }, allowLiveWrite: true },
            )
            .catch(() => undefined);
        }
      }
    });
  },
);
