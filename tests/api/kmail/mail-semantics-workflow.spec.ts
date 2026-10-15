import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { mailShape } from '@api/definitions/kmail/send.api';
import { KMAIL_PRIORITY, KMAIL_RECEIVER_TYPE } from '@api/schemas/kpost-types';

/**
 * KMail mail behaviour, three accounts (A = personal sends, B = victim receives, C = personal-3):
 * BCC privacy, priority, read status, starring / the Important list, and delete-only-your-own-side.
 * These are the semantics the endpoint-level engine never asserts (it checks each call in isolation).
 *
 * Shapes are live-measured (2026-10-14): a mail in a thread read (`selectedContactMails`) carries
 * `kmailTransactionList[]` rows with `receiver`, `receiverType` (1 To / 2 Cc / 3 Bcc), `readStatus`,
 * `markedByReceiver`, `deleteBySender/Receiver`, `transactionID`, plus top-level `priority` and
 * `kmailNumber`. The mail body is readable a few seconds after the send (an immediate read returned
 * an empty record), so the read step polls.
 */
const P = (key: string): Principal => AUTH_PROFILES.kpost.principals.find((p) => p.key === key)!;
const A = P('personal');
const B = P('victim');
const C = P('personal-3');

interface Txn {
  transactionID: number;
  receiver: string;
  receiverType: number;
  readStatus: string;
  markedByReceiver: string;
  deleteBySender: string;
  deleteByReceiver: string;
}
interface MailRow {
  kmailID: number;
  kmailNumber: number;
  priority: number;
  kmailTransactionList: Txn[];
}

test.describe(
  'KMail · mail behaviour across sender, recipient and BCC @api @kmail-api @kmail',
  { tag: ['@api', '@kmail', '@regression'] },
  () => {
    test.describe.configure({ timeout: 120_000 });
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(
      process.env.KMAIL_LIFECYCLE !== 'true',
      'sends real KMail between our accounts; set KMAIL_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || !testData.victimKpostId || !testData.personal3KpostId,
      'needs three QA accounts',
    );

    async function call(
      endpoints: EndpointExecutor,
      id: string,
      who: Principal,
      body: Record<string, unknown>,
      label: string,
    ): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
      const ex = await endpoints.sendTo(
        id,
        { body },
        { label, auth: { principal: who }, allowLiveRead: true, allowLiveWrite: true },
      );
      const parsed = ex.json();
      return {
        status: ex.status,
        json: (parsed.ok ? parsed.value : {}) as Record<string, unknown>,
        text: ex.bodyText,
      };
    }

    async function send(endpoints: EndpointExecutor, overrides: Record<string, unknown>) {
      const sent = await call(
        endpoints,
        'kmail-post-mail',
        A,
        mailShape({ toAddress: B.username, ...overrides }),
        'semantics:send',
      );
      expect(sent.status, `the mail sends: ${sent.text.slice(0, 200)}`).toBe(200);
      const data = sent.json.data as Array<{ kmailID: number }>;
      return data[0]!.kmailID;
    }

    /** The mail `kmailID` as `who` sees it in their thread with `other` (undefined when absent). */
    async function rowFor(
      endpoints: EndpointExecutor,
      who: Principal,
      other: string,
      kmailID: number,
    ): Promise<MailRow | undefined> {
      const r = await call(
        endpoints,
        'kmail-selected-contact-mails',
        who,
        {
          selectedContact: other,
          fetchMailType: 'A',
          groupFlag: false,
          lastKmailID: null,
          firstKmailID: null,
          count: 30,
        },
        'semantics:thread',
      );
      return ((r.json.data as MailRow[] | undefined) ?? []).find((m) => m.kmailID === kmailID);
    }

    async function deleteSide(endpoints: EndpointExecutor, who: Principal, ids: number[]) {
      if (!ids.length) return;
      await call(
        endpoints,
        'kmail-delete',
        who,
        { groupFlag: false, transactionIDs: ids },
        'semantics:cleanup',
      ).catch(() => undefined);
    }

    test(
      'a BCC recipient receives the mail, but the To recipient cannot see them',
      {
        annotation: [
          { type: 'requirement', description: 'RTM-KMAIL-F06' },
          { type: 'requirement', description: 'NFR-SEC02' },
        ],
      },
      async ({ endpoints }) => {
        const kmailID = await send(endpoints, {
          kmailSubject: `QA bcc privacy ${Date.now()}`,
          bccList: [C.username],
        });
        const asB = await rowFor(endpoints, B, A.username, kmailID);
        const asC = await rowFor(endpoints, C, A.username, kmailID);
        const asA = await rowFor(endpoints, A, B.username, kmailID);
        try {
          expect(asB, 'the To recipient receives the mail').toBeTruthy();
          expect(asC, 'the BCC recipient receives the mail').toBeTruthy();
          expect(
            asB?.kmailTransactionList.map((t) => t.receiver),
            'the To recipient must not see who was BCC-ed',
          ).not.toContain(C.username);
          expect(
            asA?.kmailTransactionList.find((t) => t.receiver === C.username)?.receiverType,
            'the sender sees the BCC recipient, marked as a confidential copy',
          ).toBe(KMAIL_RECEIVER_TYPE.receiverTypeConfidential);
        } finally {
          await deleteSide(
            endpoints,
            A,
            (asA?.kmailTransactionList ?? []).map((t) => t.transactionID),
          );
        }
      },
    );

    test(
      'the priority the sender chose is what the recipient sees',
      {
        annotation: [
          { type: 'requirement', description: 'FR-KM-010' },
          { type: 'requirement', description: 'FR-KM-011' },
        ],
      },
      async ({ endpoints }) => {
        const kmailID = await send(endpoints, {
          kmailSubject: `QA priority ${Date.now()}`,
          priority: KMAIL_PRIORITY.high,
        });
        const asB = await rowFor(endpoints, B, A.username, kmailID);
        try {
          expect(asB?.priority, 'a high-priority mail arrives as high priority').toBe(
            KMAIL_PRIORITY.high,
          );
        } finally {
          await deleteSide(
            endpoints,
            A,
            (asB?.kmailTransactionList ?? []).map((t) => t.transactionID),
          );
        }
      },
    );

    test(
      'a mail sent with the default priority arrives as Low — only High carries the high flag',
      {
        annotation: [
          { type: 'requirement', description: 'FR-KM-010' },
          { type: 'requirement', description: 'FR-KM-011' },
        ],
      },
      async ({ endpoints }) => {
        // The composer's default when no priority is picked is `selectedPriorityId || 0` = Low
        // (WriteMailPage.js) — so this sends exactly what an untouched Write Mail sends.
        const kmailID = await send(endpoints, {
          kmailSubject: `QA priority default ${Date.now()}`,
          priority: KMAIL_PRIORITY.low,
        });
        const asB = await rowFor(endpoints, B, A.username, kmailID);
        try {
          expect(asB?.priority, 'a default-priority mail arrives as Low').toBe(KMAIL_PRIORITY.low);
          expect(asB?.priority, 'and it does not carry the High flag').not.toBe(
            KMAIL_PRIORITY.high,
          );
        } finally {
          await deleteSide(
            endpoints,
            A,
            (asB?.kmailTransactionList ?? []).map((t) => t.transactionID),
          );
        }
      },
    );

    test('opening a mail marks it read: it leaves "sent, not opened" and the unread count drops', async ({
      endpoints,
    }) => {
      // OPEN QUESTION (2026-10-14): from the bench's API client this open call returns an empty record
      // (kmailID 0) even after 30 s of retries, while the KMail screen's identical request returns the
      // full mail (kmail-two-session-e2e.spec.ts records it). Not a confirmed product bug — the read
      // status itself works in the browser (opened mails switch to the read colour). Parked, not faked.
      test.fixme(
        true,
        'API open call returns an empty record from the bench client; browser call works — under investigation',
      );
      const subject = `QA read status ${Date.now()}`;
      const kmailID = await send(endpoints, {
        kmailSubject: subject,
        kmailContent: 'QA read-status body',
      });
      const unread = async () =>
        Number(
          (await call(endpoints, 'kmail-unopened-count', B, {}, 'semantics:unread')).json
            .UnOpenedMailCount ?? 0,
        );
      const notOpened = async () =>
        (
          await call(
            endpoints,
            'kmail-sent-not-opened',
            A,
            { selectedContact: B.username },
            'semantics:not-opened',
          )
        ).text.includes(subject);
      const row = await rowFor(endpoints, B, A.username, kmailID);
      try {
        expect(row, 'B received the mail').toBeTruthy();
        expect(await notOpened(), 'before B opens it, A sees it under "sent, not opened"').toBe(
          true,
        );
        const before = await unread();

        // Open it the way the KMail screen does (MessageContainer MailObj); the body becomes readable
        // a few seconds after the send, so poll until the real mail comes back.
        await expect
          .poll(
            async () =>
              (
                (
                  await call(
                    endpoints,
                    'kmail-mail-content',
                    B,
                    {
                      kmailID,
                      kmailNumber: row?.kmailNumber,
                      kmailType: 'Received',
                      selectedContact: A.username,
                      groupFlag: false,
                    },
                    'semantics:open',
                  )
                ).json.data as { kmailID?: number } | undefined
              )?.kmailID,
            {
              message: 'opening the mail returns its content',
              timeout: 30_000,
              intervals: [2_000],
            },
          )
          .toBe(kmailID);

        const after = await rowFor(endpoints, B, A.username, kmailID);
        expect(
          after?.kmailTransactionList.find((t) => t.receiver === B.username)?.readStatus,
          'the mail is marked read for B',
        ).toBe('Y');
        expect(await notOpened(), 'after B opens it, it leaves "sent, not opened"').toBe(false);
        expect(await unread(), 'B’s unread count drops by one').toBe(before - 1);
      } finally {
        await deleteSide(
          endpoints,
          A,
          (row?.kmailTransactionList ?? []).map((t) => t.transactionID),
        );
      }
    });

    for (const withBcc of [false, true]) {
      test(`a mail the recipient stars appears in their Important list${withBcc ? ' (mail with a BCC recipient — #1349)' : ''}`, async ({
        endpoints,
      }) => {
        const kmailID = await send(endpoints, {
          kmailSubject: `QA star${withBcc ? ' bcc' : ''} ${Date.now()}`,
          ...(withBcc ? { bccList: [C.username] } : {}),
        });
        const important = () =>
          call(
            endpoints,
            'kmail-important-mails',
            B,
            { selectedContact: A.username },
            'semantics:important',
          );
        let row: MailRow | undefined;
        try {
          expect(
            (await call(endpoints, 'kmail-set-important', B, { kmailID }, 'semantics:star')).status,
          ).toBe(200);
          row = await rowFor(endpoints, B, A.username, kmailID);
          expect(
            row?.kmailTransactionList.find((t) => t.receiver === B.username)?.markedByReceiver,
            'starring sets the recipient’s star flag',
          ).toBe('Y');
          const list = await important();
          expect(list.status, `the Important list loads: ${list.text.slice(0, 160)}`).toBe(200);
          expect(
            ((list.json.data as MailRow[] | undefined) ?? []).some((m) => m.kmailID === kmailID),
            'the starred mail is in the Important list',
          ).toBe(true);
        } finally {
          await call(endpoints, 'kmail-set-important', B, { kmailID }, 'semantics:unstar').catch(
            () => undefined,
          );
          await deleteSide(
            endpoints,
            A,
            (row?.kmailTransactionList ?? []).map((t) => t.transactionID),
          );
        }
      });
    }

    test(
      'deleting a mail removes it only from the deleter’s own side',
      { annotation: [{ type: 'requirement-partial', description: 'RTM-KMAIL-F05' }] },
      async ({ endpoints }) => {
        const kmailID = await send(endpoints, { kmailSubject: `QA delete side ${Date.now()}` });
        const asB = await rowFor(endpoints, B, A.username, kmailID);
        const bTxn = asB?.kmailTransactionList.find(
          (t) => t.receiver === B.username,
        )?.transactionID;
        expect(bTxn, 'B received the mail').toBeTruthy();
        try {
          const del = await call(
            endpoints,
            'kmail-delete',
            B,
            { groupFlag: false, transactionIDs: [bTxn] },
            'semantics:b-deletes',
          );
          expect(del.status, `B's delete is accepted: ${del.text.slice(0, 160)}`).toBe(200);
          // The server flags rather than removes (live-measured): B's own transaction is marked
          // deleteByReceiver=Y; the KMail screen hides flagged mail.
          const afterB = await rowFor(endpoints, B, A.username, kmailID);
          expect(
            afterB?.kmailTransactionList.find((t) => t.receiver === B.username)?.deleteByReceiver,
            'B’s copy is marked deleted on B’s side',
          ).toBe('Y');
          const asA = await rowFor(endpoints, A, B.username, kmailID);
          expect(asA, 'the sender still has the mail').toBeTruthy();
          expect(
            asA?.kmailTransactionList.find((t) => t.receiver === B.username)?.deleteBySender,
            'the sender’s copy is not marked deleted',
          ).toBe('N');
        } finally {
          if (bTxn) await deleteSide(endpoints, A, [bTxn]);
        }
      },
    );
  },
);
