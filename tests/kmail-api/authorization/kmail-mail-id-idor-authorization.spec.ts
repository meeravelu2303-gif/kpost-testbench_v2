import { AUTH_PROFILES } from '@config/auth-profile';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { mailShape } from '@api/definitions/kmail/send.api';
import { expect, test } from '@fixtures';

/**
 * KMail reads keyed by mail id must check that the caller is a party to each mail:
 * - getKmailDetailsUsingKmailID returned a foreign mail when one own id was in the list, and 500 for
 *   a list of only foreign ids (#13381);
 * - referenceMailContent returned the full body of any mail id (#13383), and refuses the web's own
 *   request ({referenceMails:[id]}, no kmailType) with 400 (#13384).
 * A sends B a marked mail, C (no relationship) sends B one of its own; both are deleted afterwards.
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!;
const B = K.principals.find((p) => p.key === 'victim')!;
const C = K.principals.find((p) => p.key === 'personal-3')!;

interface Sent {
  kmailID: number;
  transactionIDs: number[];
}

async function send(
  endpoints: EndpointExecutor,
  from: typeof A,
  subject: string,
  content: string,
): Promise<Sent | undefined> {
  const res = await endpoints.sendTo(
    'kmail-post-mail',
    { body: mailShape({ toAddress: B.username, kmailSubject: subject, kmailContent: content }) },
    {
      label: 'mail-id-idor:send',
      auth: { principal: from },
      allowLiveWrite: true,
    },
  );
  const parsed = res.json();
  const body = (parsed.ok ? parsed.value : {}) as { data?: unknown };
  const row = (Array.isArray(body.data) ? body.data[0] : body.data) as
    { kmailID?: number; kmailTransactionList?: Array<{ transactionID?: number }> } | undefined;
  if (!row?.kmailID) return undefined;
  return {
    kmailID: Number(row.kmailID),
    transactionIDs: (row.kmailTransactionList ?? [])
      .map((t) => t.transactionID)
      .filter((v): v is number => typeof v === 'number'),
  };
}

const ids = (text: string): number[] => {
  try {
    const data = (JSON.parse(text) as { data?: Array<{ kmailID?: number }> }).data;
    return Array.isArray(data) ? data.map((m) => Number(m.kmailID)) : [];
  } catch {
    return [];
  }
};

test.describe(
  'KMail · reads by mail id are limited to the mail’s parties @api @kmail-api @kmail @security',
  {
    tag: ['@api', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(process.env.KMAIL_LIFECYCLE !== 'true', 'sends real mails; set KMAIL_LIFECYCLE=true');

    test('an outsider cannot read a mail by id, alone or alongside one of their own', async ({
      endpoints,
    }) => {
      const stamp = Date.now();
      const marker = `QA-SECRET-ID-READ-${stamp}`;
      let foreign: Sent | undefined;
      let own: Sent | undefined;
      // The ids this test minted, trusted by the QA-identifier guard on its own requests.
      const minted = (): number[] =>
        [foreign, own].flatMap((m) => (m ? [m.kmailID, ...m.transactionIDs] : []));
      try {
        foreign = await send(endpoints, A, `QA id-read proof ${stamp}`, marker);
        own = await send(endpoints, C, `QA id-read control ${stamp}`, 'QA bench control mail');
        test.skip(!foreign || !own, 'a setup mail returned no kmailID right now');
        // Content is stored asynchronously after the send returns.
        await new Promise((resolve) => setTimeout(resolve, 5_000));

        // Owner control: B, the receiver, reads both ways.
        const ownerDetails = await endpoints.sendTo(
          'kmail-details-by-id',
          { body: { kmailIDs: [foreign!.kmailID] } },
          {
            label: 'mail-id-idor:owner-details',
            auth: { principal: B },
            allowLiveRead: true,
            ownedIdentifiers: minted(),
          },
        );
        expect(ids(ownerDetails.bodyText), 'the receiver reads its mail (control)').toContain(
          foreign!.kmailID,
        );

        // getKmailDetailsUsingKmailID (#13381).
        const mixed = await endpoints.sendTo(
          'kmail-details-by-id',
          { body: { kmailIDs: [own!.kmailID, foreign!.kmailID] } },
          {
            label: 'mail-id-idor:mixed',
            auth: { principal: C },
            allowLiveRead: true,
            ownedIdentifiers: minted(),
          },
        );
        expect
          .soft(
            ids(mixed.bodyText),
            'with one own id in the list, the foreign mail must still be left out (#13381)',
          )
          .not.toContain(foreign!.kmailID);
        const onlyForeign = await endpoints.sendTo(
          'kmail-details-by-id',
          { body: { kmailIDs: [foreign!.kmailID] } },
          {
            label: 'mail-id-idor:foreign',
            auth: { principal: C },
            allowLiveRead: true,
            ownedIdentifiers: minted(),
          },
        );
        expect
          .soft(onlyForeign.status, 'a list of only foreign ids is refused, not a server error')
          .toBeLessThan(500);
        expect
          .soft(ids(onlyForeign.bodyText), 'and returns no foreign mail')
          .not.toContain(foreign!.kmailID);

        // referenceMailContent (#13383, #13384).
        const webBody = await endpoints.sendTo(
          'kmail-reference-content',
          { body: { referenceMails: [foreign!.kmailID] } },
          {
            label: 'mail-id-idor:ref-web-body',
            auth: { principal: B },
            allowLiveRead: true,
            ownedIdentifiers: minted(),
          },
        );
        expect
          .soft(webBody.status, "the web's own request ({referenceMails}) is accepted (#13384)")
          .toBeLessThan(300);
        const outsider = await endpoints.sendTo(
          'kmail-reference-content',
          { body: { referenceMails: [foreign!.kmailID], kmailType: '0' } },
          {
            label: 'mail-id-idor:ref-outsider',
            auth: { principal: C },
            allowLiveRead: true,
            ownedIdentifiers: minted(),
          },
        );
        expect
          .soft(
            outsider.bodyText.includes(marker),
            'an outsider must not get the body of a mail they are not part of (#13383)',
          )
          .toBe(false);
      } finally {
        for (const [who, mail] of [
          [A, foreign],
          [C, own],
        ] as const) {
          if (!mail?.transactionIDs.length) continue;
          await endpoints
            .sendTo(
              'kmail-delete',
              { body: { groupFlag: false, transactionIDs: mail.transactionIDs } },
              {
                label: 'mail-id-idor:cleanup',
                auth: { principal: who },
                allowLiveWrite: true,
                ownedIdentifiers: minted(),
              },
            )
            .catch(() => undefined);
        }
      }
    });
  },
);
