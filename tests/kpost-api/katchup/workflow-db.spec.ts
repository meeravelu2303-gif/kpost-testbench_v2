import { testData } from '@config/test-data.config';
import { env } from '@config/env';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { text } from '@database/kpost-assertions';
import { KpostRepository } from '@database/repositories/kpost.repository';
import type { KatchupMessageRecord } from '@database/repositories/kpost.repository';
import { expect, test } from '@fixtures';
import { flowState, needs } from '../../support/flow-state';

/**
 * The Katchup message lifecycle (send, read, delete, recall) checked in MySQL after every step, so a
 * failure names the step that broke. Gated behind `KATCHUP_LIFECYCLE=true`: it writes a real message
 * between our own two accounts and cleans up after itself.
 */
test.describe(
  'KPost Katchup · lifecycle with MySQL assertions @api @kpost-api @katchup @database',
  { tag: ['@api', '@katchup', '@regression'] },
  () => {
    // In order, but a failed step never skips the others; only a missing msgID blocks read/recall.
    test.describe.configure({ mode: 'default' });
    test.skip(
      process.env.KATCHUP_LIFECYCLE !== 'true',
      'writes a real message; set KATCHUP_LIFECYCLE=true to run (owner sign-off, flow doc Q4)',
    );

    const subject = `QA Bench DB ${Date.now()}`;
    const message = 'QA bench cross-layer lifecycle — safe to ignore.';
    const flow = flowState<{ msgId: number }>('katchup-workflow-db');

    /** The row, or undefined. Keyed on `msg_id`, so this is a primary-key lookup. */
    async function row(
      repo: KpostRepository,
      id: number | undefined,
    ): Promise<KatchupMessageRecord | undefined> {
      return id === undefined ? undefined : repo.katchupMessage(id);
    }

    test.afterAll(() => {
      const msgId = flow.get('msgId');
      if (msgId !== undefined && !env.CI) {
        test.info().annotations.push({
          type: 'note',
          description: `cross-layer lifecycle used msg_id ${msgId} (recalled)`,
        });
      }
    });

    test('send: the API returns a msgID and MySQL holds the message it describes', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection to assert persistence');

      const exchange = await endpoints.sendTo(
        'katchup-send-message',
        { body: sendShape({ subject, actualMessage: message }) },
        { label: 'workflow-db:send', allowLiveWrite: true },
      );

      expect(exchange.status, 'the send succeeds').toBeLessThan(300);
      const parsed = exchange.json();
      expect(parsed.ok, 'the send returns JSON').toBe(true);

      const data = parsed.ok ? (parsed.value as { data?: unknown }).data : undefined;
      const created = Array.isArray(data) ? (data[0] as Record<string, unknown>) : undefined;
      expect(created?.msgID, 'a numeric msgID was issued').toEqual(expect.any(Number));
      const msgId = created?.msgID as number;
      flow.set('msgId', msgId);

      const stored = await row(new KpostRepository(database), msgId);

      expect(stored, `TBL_KPOST_KATCHUP_MESSAGES must hold msg_id ${String(msgId)}`).toBeDefined();
      // `subject` is a BLOB, so it is decoded before comparison.
      expect(text(stored?.subject), 'the Subject is persisted as sent (BR-K01)').toBe(subject);
      expect(text(stored?.sender), 'the sender is the calling account').toBe(testData.kpostId);
      // Guards `sendShape`'s default receiver (our second account).
      expect(text(stored?.receiver), 'the receiver is the second QA account').toBe(
        testData.victimKpostId,
      );
      expect(stored?.server_time, 'the server stamped its own receipt time').toBeTruthy();
      // A message nobody has touched must not arrive already deleted for either party.
      expect(Number(stored?.deleted_by_sender ?? 0), 'not deleted for the sender').toBe(0);
      expect(Number(stored?.deleted_by_receiver ?? 0), 'not deleted for the receiver').toBe(0);
    });

    test('read back: the id-keyed read returns the same message the database holds', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection to assert persistence');
      const msgId = flow.get('msgId');
      needs(msgId, 'the message from "send"');

      const stored = await row(new KpostRepository(database), msgId);
      expect(stored, 'the row still exists before the read').toBeDefined();

      const exchange = await endpoints.sendTo(
        'katchup-conversation',
        {
          body: {
            groupFlag: false,
            firstMsgID: null,
            lastMsgID: null,
            receiver: testData.victimKpostId,
          },
        },
        { label: 'workflow-db:read' },
      );

      // Compared with the DB's stored copy, not with what the test sent.
      expect(exchange.status, 'the read succeeds').toBeLessThan(300);
      expect(exchange.bodyText, 'the response carries the stored subject').toContain(
        text(stored?.subject) ?? subject,
      );
    });

    // Delete uses its own seed message, so it runs whatever happened to the message above.
    test('delete: the message is soft-deleted, not removed from the table', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection to assert persistence');

      const seed = await endpoints.sendTo(
        'katchup-send-message',
        { body: sendShape({ subject: `${subject} delete-test`, actualMessage: message }) },
        { label: 'workflow-db:delete-seed', allowLiveWrite: true },
      );
      expect(seed.status, 'the seed send succeeds').toBeLessThan(300);
      const seedParsed = seed.json();
      const seedData = seedParsed.ok ? (seedParsed.value as { data?: unknown }).data : undefined;
      const seedRow = Array.isArray(seedData)
        ? (seedData[0] as Record<string, unknown>)
        : undefined;
      const deleteMsgId = seedRow?.msgID as number | undefined;
      expect(deleteMsgId, 'a numeric msgID was issued for the seed').toEqual(expect.any(Number));

      const exchange = await endpoints.sendTo(
        'katchup-delete-message',
        { body: { messageIds: [deleteMsgId], groupFlag: false } },
        { label: 'workflow-db:delete', allowLiveWrite: true },
      );
      expect(exchange.status, 'delete succeeds — the message is cleaned up').toBeLessThan(300);

      const stored = await row(new KpostRepository(database), deleteMsgId);

      // Delete is per participant: the row must survive with a flag set, or the recipient loses it too.
      expect(
        stored,
        'a per-participant delete must leave the row in place for the other party',
      ).toBeDefined();
      expect(
        Number(stored?.deleted_by_sender ?? 0),
        'deleted_by_sender records who removed it',
      ).toBe(1);
    });

    test('recall: the API reports success AND MySQL marks message_type as recalled', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection to assert persistence');
      const msgId = flow.get('msgId');
      needs(msgId, 'the message from "send"');

      const before = await row(new KpostRepository(database), msgId);
      const originalMessageType = Number(before?.message_type ?? 0);

      const exchange = await endpoints.sendTo(
        'katchup-recall-message',
        { body: { msgID: msgId, groupFlag: false } },
        { label: 'workflow-db:recall', allowLiveWrite: true },
      );
      expect(exchange.status, 'the recall is accepted').toBeLessThan(300);

      const stored = await row(new KpostRepository(database), msgId);

      // Recall is stored in `message_type` (0 → 7), not in the deleted_by_* flags.
      expect(stored, 'a recall is a soft delete: the row must still exist').toBeDefined();
      const recalledMessageType = Number(stored?.message_type ?? 0);
      expect
        .soft(
          recalledMessageType,
          `recall must change message_type from its original value (${originalMessageType}) — ` +
            `stayed at ${recalledMessageType}, so recall changed nothing`,
        )
        .not.toBe(originalMessageType);
    });
  },
);
