import { expect, test } from '@fixtures';
import { assertQaOwnedIdentifiers, foreignIdentifiers } from '@engine/qa-identifier-guard';
import { ProductionSafetyError } from '@engine/production-guard';
import {
  forgetOwnedResources,
  ownsResource,
  ResourceLedger,
  type ResourceOwner,
} from '../../src/test-data/index';

/**
 * Guards for the **runtime-owned identifier** rule — the correction the Phase 2.5 live verification
 * forced.
 *
 * The live run showed that Katchup message cleanup had never worked on a real host: the delete
 * endpoint's real field is `messageIds` (plural, an array — the shape the live client sends), and the
 * QA-identifier guard refused every such request because a message id the API minted at runtime can
 * never be a `QA_*` value in `.env`. The old lifecycle wrapped the delete in `.catch(() => undefined)`,
 * so nobody saw it; Phase 2.5 removed the swallow and the leak became visible.
 *
 * The wrong fix is to add `messageids` to `NOT_A_RESOURCE`, which would switch the check off for the
 * field entirely and let a stranger's message id through. The fix under test here keeps the
 * protection and adds ownership: a runtime-id field may name the resources THIS RUN created and
 * tracked in its ledger, and nothing else.
 *
 * Every case below is offline — `foreignIdentifiers` is a pure function over a payload, so no request
 * is built and no host is contacted.
 */

const OWNER: ResourceOwner = {
  runId: 'run-owned-guard-1',
  testCaseId: 'TC-API-kpost-api-katchup-delete-message-cleanup',
  slot: 0,
};

/** A message id of the shape the API mints (the live run's range was 811422–811443). */
const OWNED_MESSAGE_ID = 811999;
/** Someone else's message — never registered, so never ours. */
const FOREIGN_MESSAGE_ID = 700001;

/** The message a refusal carries, so a test can assert what it does and does not say. */
function refusalMessage(request: Parameters<typeof assertQaOwnedIdentifiers>[0]): string {
  try {
    assertQaOwnedIdentifiers(request, 'feature:cleanup', true);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

/** A ledger that has tracked one message, exactly as the lifecycle does the moment it is sent. */
function ledgerOwningOneMessage(): ResourceLedger {
  const ledger = new ResourceLedger({ owner: OWNER });
  ledger.track({
    kind: 'katchup-message',
    id: OWNED_MESSAGE_ID,
    describe: 'message from personal',
  });
  return ledger;
}

test.describe('QA-identifier guard · runtime-owned resources', () => {
  test.describe.configure({ mode: 'default' });

  test.beforeEach(() => {
    // Ownership is process-wide by design; each case states its own starting point.
    forgetOwnedResources();
  });

  test.afterAll(() => {
    forgetOwnedResources();
  });

  test('CASE 1 — a tracked message id in messageIds is ALLOWED', () => {
    ledgerOwningOneMessage();

    const foreign = foreignIdentifiers({
      body: { messageIds: [OWNED_MESSAGE_ID], groupFlag: false },
    });

    expect(foreign, 'the run may delete the message it created').toEqual([]);
  });

  test('CASE 2 — a foreign message id in messageIds is REJECTED', () => {
    ledgerOwningOneMessage();

    const foreign = foreignIdentifiers({
      body: { messageIds: [FOREIGN_MESSAGE_ID], groupFlag: false },
    });

    expect(foreign.map((offence) => offence.path)).toEqual(['body.messageIds[0]']);

    // And it is a hard refusal on a real host, not a soft finding.
    expect(() =>
      assertQaOwnedIdentifiers(
        { body: { messageIds: [FOREIGN_MESSAGE_ID], groupFlag: false } },
        'feature:cleanup',
        true,
      ),
    ).toThrow(ProductionSafetyError);
  });

  test('CASE 3 — a MIXED array (one owned, one foreign) is REJECTED on the foreign element', () => {
    ledgerOwningOneMessage();

    const foreign = foreignIdentifiers({
      body: { messageIds: [OWNED_MESSAGE_ID, FOREIGN_MESSAGE_ID], groupFlag: false },
    });

    /*
     * The element-by-element check is what makes this safe: a payload cannot smuggle a stranger's
     * record in beside one of ours and have the request pass because "most of it is owned".
     */
    expect(foreign.map((offence) => offence.path)).toEqual(['body.messageIds[1]']);
    expect(foreign.map((offence) => offence.value)).toEqual([FOREIGN_MESSAGE_ID]);
  });

  test('an UNTRACKED message id is refused even though the field is now understood', () => {
    // Nothing registered at all: the field is ownership-checked, not exempt.
    expect(ownsResource('katchup-message', OWNED_MESSAGE_ID)).toBe(false);
    expect(
      foreignIdentifiers({ body: { messageIds: [OWNED_MESSAGE_ID] } }).map((o) => o.path),
      'ownership comes from the ledger, never from the field name',
    ).toEqual(['body.messageIds[0]']);
  });

  test('ownership is per KIND — tracking a group does not license a message id', () => {
    const ledger = new ResourceLedger({ owner: OWNER });
    ledger.track({ kind: 'katchup-group', id: FOREIGN_MESSAGE_ID });

    expect(
      foreignIdentifiers({ body: { messageIds: [FOREIGN_MESSAGE_ID] } }).map((o) => o.path),
      'a group id does not authorise deleting a message with the same number',
    ).toEqual(['body.messageIds[0]']);
  });

  test('a string id matches the number the API minted (and vice versa)', () => {
    ledgerOwningOneMessage();
    // The ledger stores ids as strings; the payload sends the number the response carried.
    expect(foreignIdentifiers({ body: { messageIds: [String(OWNED_MESSAGE_ID)] } })).toEqual([]);
    expect(foreignIdentifiers({ body: { messageIds: OWNED_MESSAGE_ID } })).toEqual([]);
  });

  test('CASE 4 — every previously-supported identifier field behaves exactly as before', () => {
    ledgerOwningOneMessage();

    /*
     * The ownership rule is scoped to the fields in RUNTIME_RESOURCE_FIELD. Tracking a message must
     * not license the SAME value under a tenant key, or the correction would have become the hole it
     * was meant to avoid.
     */
    const tenantKeyed = foreignIdentifiers({
      body: {
        companyId: 4,
        kpostID: 'someone.else@kpostindia.com',
        contactID: 'prakas168@kpostindia.com',
        memberKpostIdList: ['jitendra9@kpostindia.com'],
        // The owned message id under a TENANT key is still a stranger's account number.
        companyID: OWNED_MESSAGE_ID,
      },
    });
    expect(tenantKeyed.map((offence) => offence.path).sort()).toEqual([
      'body.companyID',
      'body.companyId',
      'body.contactID',
      'body.kpostID',
      'body.memberKpostIdList[0]',
    ]);

    // The existing runtime exemptions are untouched: still exempt, still not ownership-checked.
    expect(
      foreignIdentifiers({ body: { msgID: 811001, kallIds: [2, 3], groupID: 1141, id: 41307 } }),
      'msgID/kallID/groupID/bare-id keep their NOT_A_RESOURCE treatment',
    ).toEqual([]);

    // Reference data and bench-generated values are unaffected.
    expect(
      foreignIdentifiers({ body: { countryID: 1, sessionID: 'abc', statusCode: 200 } }),
    ).toEqual([]);
  });

  test('CASE 5 — the guard still does nothing off a real host, and everything on one', () => {
    ledgerOwningOneMessage();

    // Off a real host (the bundled mock) fuzzing ids is the point: the guard must not fire.
    expect(() =>
      assertQaOwnedIdentifiers({ body: { companyId: 4 } }, 'mock:probe', false),
    ).not.toThrow();

    // On a real host — live app and disposable test deployment alike — it refuses.
    expect(() => assertQaOwnedIdentifiers({ body: { companyId: 4 } }, 'live:probe', true)).toThrow(
      ProductionSafetyError,
    );
  });

  test('CASE 6 — a guard refusal names the offending id and no credential', () => {
    ledgerOwningOneMessage();

    const message = refusalMessage({
      body: {
        messageIds: [FOREIGN_MESSAGE_ID],
        password: 'Kpost@123',
        accessToken: 'eyJhbGciOiJIUzI1NiJ9.super-secret.signature',
        cookie: 'JSESSIONID=abcdef',
        apiKey: 'ak_live_9f2a',
      },
    });

    expect(message, 'the refusal must say which id was refused').toContain(
      String(FOREIGN_MESSAGE_ID),
    );
    for (const secret of ['Kpost@123', 'eyJhbGciOiJIUzI1NiJ9', 'JSESSIONID', 'ak_live_9f2a']) {
      expect(message, `the refusal must not carry ${secret}`).not.toContain(secret);
    }
  });

  test('the Katchup cleanup payload passes once the message is tracked, and only then', () => {
    /*
     * The end-to-end shape, as `deleteMessage` in the Katchup feature spec builds it. This is the
     * exact request the live verification saw refused; it is what must now pass for an owned id.
     */
    const payload = (msgID: number): { body: Record<string, unknown> } => ({
      body: { messageIds: [msgID], groupFlag: false },
    });

    expect(foreignIdentifiers(payload(OWNED_MESSAGE_ID)), 'before tracking: refused').toHaveLength(
      1,
    );

    ledgerOwningOneMessage();

    expect(foreignIdentifiers(payload(OWNED_MESSAGE_ID)), 'after tracking: allowed').toEqual([]);
    expect(
      foreignIdentifiers(payload(FOREIGN_MESSAGE_ID)),
      'a stranger: still refused',
    ).toHaveLength(1);
  });
});
