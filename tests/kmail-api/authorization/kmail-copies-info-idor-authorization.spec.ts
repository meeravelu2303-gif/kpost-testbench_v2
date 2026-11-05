import { AUTH_PROFILES } from '@config/auth-profile';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { mailShape } from '@api/definitions/kmail/send.api';
import { expect, test } from '@fixtures';

/**
 * KMail recipient-list IDOR (getCopiesInfo): can an outsider (C) read the To and CC addresses of a
 * mail A sent to B and CC, by kmailID alone? The verdict is the response body (it answers 200 either way).
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // sender
const B = K.principals.find((p) => p.key === 'victim')!; // To
const CC = K.principals.find((p) => p.key === 'personal-4')!; // Copy / CC
const C = K.principals.find((p) => p.key === 'personal-3')!; // outsider — no relationship to the mail

test.describe(
  'KMail · recipient-list IDOR (getCopiesInfo) @api @kmail-api @kmail @security',
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
    test.skip(
      !A || !B || !CC || !C,
      'needs four distinct QA principals configured (QA_* accounts)',
    );

    test('an outsider cannot read the To/CC recipient list of a mail they are not part of', async ({
      endpoints,
    }) => {
      const subject = `QA IDOR copies proof ${Date.now()}`;
      let transactionIDs: number[] = [];
      let kmailId: number | undefined;

      try {
        // --- Setup: A sends a real mail with a To and a CC -------------------------------------
        const sent = await endpoints.sendTo(
          'kmail-post-mail',
          {
            body: mailShape({
              toAddress: B.username,
              ccList: [CC.username],
              kmailSubject: subject,
              kmailContent: `QA copies-idor body ${Date.now()}`,
            }),
          },
          { label: 'copies-idor:send', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(sent.status, 'the mail is sent').toBeLessThan(300);
        const sentJson = sent.json();
        const sentBody = (sentJson.ok ? sentJson.value : {}) as Record<string, unknown>;
        const row = Array.isArray(sentBody.data)
          ? (sentBody.data[0] as Record<string, unknown>)
          : (sentBody.data as Record<string, unknown> | undefined);
        kmailId = Number(row?.kmailID);
        const txns = row?.kmailTransactionList;
        transactionIDs = Array.isArray(txns)
          ? (txns as Array<Record<string, unknown>>)
              .map((t) => t.transactionID)
              .filter((v): v is number => typeof v === 'number')
          : [];
        test.skip(
          !kmailId || Number.isNaN(kmailId),
          `kmail-post-mail did not return a kmailID (${sent.status})`,
        );

        await new Promise((resolve) => setTimeout(resolve, 2_000));

        // --- Attack: C (outsider) asks for the mail's recipient list by id ---------------------
        const attack = await endpoints.sendTo(
          'kmail-copies-info',
          { pathParams: { kmailID: kmailId } },
          {
            label: 'copies-idor:attack',
            auth: { principal: C },
            allowLiveRead: true,
          },
        );
        const attackText = attack.bodyText.toLowerCase();
        const leakedTo = attackText.includes(B.username.toLowerCase());
        const leakedCc = attackText.includes(CC.username.toLowerCase());
        const leaked = leakedTo || leakedCc;

        test.info().annotations.push({
          type: 'observed',
          description: `outsider getCopiesInfo(${kmailId}) status=${attack.status} leakedTo=${leakedTo} leakedCc=${leakedCc}`,
        });

        if (leaked) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kmail-copies-info',
            ruleId: 'IDOR-kmail-copies-info-by-id',
            rule:
              "A mail's recipient list (To/Copy) must only be readable by a participant — an unrelated " +
              'account must not read it by kmailID alone.',
            expected: "the outsider's response must not contain any recipient address of the mail",
            actual:
              `status=${attack.status}, response disclosed ${leakedTo ? 'the To address' : ''}` +
              `${leakedTo && leakedCc ? ' and ' : ''}${leakedCc ? 'the CC address' : ''} of a mail ` +
              `${A.username} sent (kmailID ${kmailId}) to ${C.username}, who is not a participant`,
            request: { pathParams: { kmailID: kmailId } },
          });
        }

        expect
          .soft(
            leaked,
            `BOLA (#1363): an outsider must not read the To/CC recipient list of a mail they are not part of ` +
              `(getCopiesInfo replied ${attack.status}; leakedTo=${leakedTo}, leakedCc=${leakedCc})`,
          )
          .toBe(false);
      } finally {
        if (transactionIDs.length) {
          await endpoints
            .sendTo(
              'kmail-delete',
              { body: { groupFlag: false, transactionIDs } },
              { label: 'copies-idor:cleanup', auth: { principal: A }, allowLiveWrite: true },
            )
            .catch(() => undefined);
        }
      }
    });
  },
);
