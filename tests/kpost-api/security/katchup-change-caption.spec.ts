import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { isSqlClient, type SqlDatabaseClient } from '@database/database-client';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Katchup changeCaption (KatchupServiceImpl.captionChange): a one-off migration that rewrites
 * "attachmentDetails" to "attachmentCaption" in the reference text of every msgID it is given, with
 * no check that the caller is in the conversation. No client calls it. Our own message carries the
 * old key on purpose, so the rewrite is visible in the row: a stranger's call must leave it, the
 * sender's own call (the control) shows the rewrite works. QA test server only; self-cleaning.
 */
const K = AUTH_PROFILES.kpost;
const SENDER = K.principals.find((p) => p.key === 'personal-5');
const RECEIVER = K.principals.find((p) => p.key === 'personal-4');
const STRANGER = K.principals.find((p) => p.key === 'personal-3');

/** A reference in the pre-migration shape the endpoint rewrites. */
const OLD_REFERENCE = JSON.stringify({ actualMessage: 'QA bench', attachmentDetails: '[]' });

async function sendOne(endpoints: EndpointExecutor): Promise<number> {
  const ex = await endpoints.sendTo(
    'katchup-send-message',
    { body: sendShape({ receiver: RECEIVER!.username, referenceMessage: OLD_REFERENCE }) },
    {
      label: 'change-caption:send',
      auth: { principal: SENDER! },
      allowLiveWrite: true,
      // The planted reference is this flow's own string, not an id.
      ownedIdentifiers: [OLD_REFERENCE],
    },
  );
  const parsed = ex.json();
  const data = ((parsed.ok ? parsed.value : {}) as { data?: Array<{ msgID?: number }> }).data;
  const msgID = data?.[0]?.msgID;
  expect(msgID, `the source message is sent (${ex.status})`).toBeTruthy();
  return msgID!;
}

async function reference(db: SqlDatabaseClient, msgID: number): Promise<string> {
  const [row] = await db.query<{ ref: string }>(
    'SELECT CAST(reference_message AS CHAR) ref FROM TBL_KPOST_KATCHUP_MESSAGES WHERE msg_id = ?',
    [msgID],
  );
  return row?.ref ?? '';
}

const rewrite = (endpoints: EndpointExecutor, as: Principal, msgID: number, label: string) =>
  endpoints.sendTo(
    'katchup-change-caption',
    { body: { referenceMessageIDList: [msgID] } },
    {
      label: `change-caption:${label}`,
      auth: { principal: as },
      allowGlobalLifecycle: true,
      ownedIdentifiers: [msgID],
    },
  );

test.describe(
  'KPost Security · Katchup changeCaption rewrites only the caller’s own messages',
  {
    tag: ['@api', '@katchup', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      process.env.GLOBAL_LIFECYCLE !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'rewrites real message rows on the QA test server; set GLOBAL_LIFECYCLE=true and TEST_DB_MODE=true',
    );
    test.skip(!SENDER || !RECEIVER || !STRANGER, 'needs the 3rd, 4th and 5th QA accounts');

    test('a stranger cannot rewrite another conversation’s message; the sender can', async ({
      endpoints,
      databases,
    }) => {
      const db = databases.for('kpost-api');
      test.skip(!isSqlClient(db), 'needs the KPOST_QA database to read the row');
      if (!isSqlClient(db)) return;
      const sent: number[] = [];
      try {
        const theirs = await sendOne(endpoints);
        sent.push(theirs);
        expect(await reference(db, theirs), 'the row holds the old key').toContain(
          'attachmentDetails',
        );

        const attempt = await rewrite(endpoints, STRANGER!, theirs, 'stranger');
        const after = await reference(db, theirs);
        const tookEffect = after.includes('attachmentCaption');
        if (tookEffect) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-change-caption',
            ruleId: 'IDOR-change-caption-by-non-participant',
            rule: 'changeCaption rewrites the reference text of every msgID it is given; it must refuse messages from conversations the caller is not part of.',
            expected: 'the stranger is refused and the row is unchanged',
            actual: `a non-participant's call answered ${attempt.status} and rewrote msg ${theirs}`,
            request: { body: { referenceMessageIDList: [theirs] } },
          });
        }
        expect
          .soft(
            tookEffect,
            `a non-participant cannot rewrite the message (answered ${attempt.status})`,
          )
          .toBe(false);

        // Control: the sender's own call on a fresh message shows the rewrite really works.
        const mine = await sendOne(endpoints);
        sent.push(mine);
        const own = await rewrite(endpoints, SENDER!, mine, 'sender');
        expect.soft(own.status, 'the sender’s own call is accepted').toBe(200);
        expect
          .soft(await reference(db, mine), 'and the sender’s message is rewritten')
          .toContain('attachmentCaption');
      } finally {
        for (const msgID of sent) {
          await endpoints
            .sendTo(
              'katchup-delete-message',
              { body: { messageIds: [msgID], groupFlag: false } },
              {
                label: 'change-caption:cleanup',
                auth: { principal: SENDER! },
                allowLiveWrite: true,
              },
            )
            .catch(() => undefined);
        }
      }
    });
  },
);
