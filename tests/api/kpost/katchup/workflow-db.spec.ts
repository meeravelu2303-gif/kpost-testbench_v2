import { testData } from '@config/test-data.config';
import { env } from '@config/env';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { text } from '@database/kpost-assertions';
import { KpostRepository } from '@database/repositories/kpost.repository';
import type { KatchupMessageRecord } from '@database/repositories/kpost.repository';
import { expect, test } from '@fixtures';

/**
 * The Katchup message lifecycle, asserted at **both** layers after every step.
 *
 * ## What this adds over `lifecycle.spec.ts`
 *
 * That flow proves the API's own story: send returns a `msgID`, read returns the message, recall
 * reports success. This one asks whether the database agrees — and the interesting cases are
 * exactly the ones where it might not:
 *
 *  - A send that answers 200 having stored the subject as an empty BLOB.
 *  - A recall that reports success and leaves `deleted_by_sender` clear, so the message is still in
 *    the sender's own thread.
 *  - A delete that removes the row outright where the product promises a soft delete, taking the
 *    recipient's copy with it.
 *
 * None of those is visible from the response. Every one is a single column.
 *
 * ## Why the state is captured between steps rather than only at the end
 *
 * A lifecycle assertion made once at the end cannot say *which* step broke. Reading the row after
 * each transition costs one indexed query on a primary key and turns "the message is wrong" into
 * "recall did not set the flag" — the difference between a ticket a developer can act on and one
 * they have to reproduce first.
 *
 * ## Safety
 *
 * It writes a real message between our own two accounts and cleans up after itself, so it carries
 * the same `KATCHUP_LIFECYCLE` opt-in as the existing flow, for the same reason: until the owner
 * has signed off on sending on the live application, this must not run there by accident.
 */
test.describe('KPost Katchup · lifecycle with MySQL assertions @api @kpost-api @katchup', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    process.env.KATCHUP_LIFECYCLE !== 'true',
    'writes a real message; set KATCHUP_LIFECYCLE=true to run (owner sign-off, flow doc Q4)',
  );

  const subject = `QA Bench DB ${Date.now()}`;
  const message = 'QA bench cross-layer lifecycle — safe to ignore.';
  let msgId: number | undefined;

  /** The row, or undefined. Keyed on `msg_id`, so this is a primary-key lookup. */
  async function row(
    repo: KpostRepository,
    id: number | undefined,
  ): Promise<KatchupMessageRecord | undefined> {
    return id === undefined ? undefined : repo.katchupMessage(id);
  }

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
    msgId = created?.msgID as number;

    const stored = await row(new KpostRepository(database), msgId);

    expect(stored, `TBL_KPOST_KATCHUP_MESSAGES must hold msg_id ${String(msgId)}`).toBeDefined();
    /*
     * Decoded before comparison. `subject` is a BLOB, so a raw equality check fails even when the
     * stored bytes are exactly right — which would read as "the API stored the wrong subject" on a
     * perfectly healthy API.
     */
    expect(text(stored?.subject), 'the Subject is persisted as sent (BR-K01)').toBe(subject);
    expect(text(stored?.sender), 'the sender is the calling account').toBe(testData.kpostId);
    // `sendShape` addresses our second account; asserted here so a change to that default shows up
    // as a failing expectation rather than as a message quietly sent somewhere else.
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
    test.skip(
      !database.enabled || msgId === undefined,
      'needs the sent message from the first step',
    );

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

    /*
     * The read is asserted against the DATABASE's copy, not against what the test sent. If the API
     * ever returned a different message for this id — the class of bug the concurrency probes look
     * for from the other direction — comparing against our own variable would hide it, because our
     * variable is what we hoped for rather than what is stored.
     */
    expect(exchange.status, 'the read succeeds').toBeLessThan(300);
    expect(exchange.bodyText, 'the response carries the stored subject').toContain(
      text(stored?.subject) ?? subject,
    );
  });

  test('recall: the API reports success AND MySQL marks it deleted for the sender', async ({
    endpoints,
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(
      !database.enabled || msgId === undefined,
      'needs the sent message from the first step',
    );

    const exchange = await endpoints.sendTo(
      'katchup-recall-message',
      { body: { msgID: msgId, groupFlag: false } },
      { label: 'workflow-db:recall', allowLiveWrite: true },
    );
    expect(exchange.status, 'the recall is accepted').toBeLessThan(300);

    const stored = await row(new KpostRepository(database), msgId);

    /*
     * The assertion the response cannot make. A recall that answers SUCCESS and leaves both flags
     * clear has changed nothing — the message is still in both threads — and every API-only test
     * would pass.
     */
    expect(stored, 'a recall is a soft delete: the row must still exist').toBeDefined();
    const senderDeleted = Number(stored?.deleted_by_sender ?? 0);
    const receiverDeleted = Number(stored?.deleted_by_receiver ?? 0);
    expect(
      senderDeleted === 1 || receiverDeleted === 1,
      `recall reported success but neither deletion flag moved ` +
        `(deleted_by_sender=${senderDeleted}, deleted_by_receiver=${receiverDeleted})`,
    ).toBe(true);
  });

  test('delete: the message is soft-deleted, not removed from the table', async ({
    endpoints,
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(
      !database.enabled || msgId === undefined,
      'needs the sent message from the first step',
    );

    const exchange = await endpoints.sendTo(
      'katchup-delete-message',
      { body: { msgID: msgId, groupFlag: false } },
      { label: 'workflow-db:delete', allowLiveWrite: true },
    );
    expect(exchange.status, 'delete succeeds — the message is cleaned up').toBeLessThan(300);

    const stored = await row(new KpostRepository(database), msgId);

    /*
     * The distinction that matters, and the one the response cannot express: KPost deletes a
     * Katchup message per participant, so the ROW must survive with a flag set. A hard delete would
     * also take the counterparty's copy — the recipient's message vanishing because the sender
     * tidied up is a data-loss defect, and on the wire it looks identical to a correct soft delete.
     */
    expect(
      stored,
      'a per-participant delete must leave the row in place for the other party',
    ).toBeDefined();
    expect(Number(stored?.deleted_by_sender ?? 0), 'deleted_by_sender records who removed it').toBe(
      1,
    );
  });

  test.afterAll(() => {
    if (msgId !== undefined && !env.CI) {
      test.info().annotations.push({
        type: 'note',
        description: `cross-layer lifecycle used msg_id ${msgId} (recalled)`,
      });
    }
  });
});
