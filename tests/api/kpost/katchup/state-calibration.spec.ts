import type { ActorRoleId } from '../../../../src/actors/index';
import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
// A controlled multi-step live scenario (send → observe → observe → observe), not simple assertions;
// the conditionals guard optional steps and best-effort handling of real live data.
/* eslint-disable playwright/no-conditional-in-test */
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@config/constants';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import {
  CalibrationSession,
  KATCHUP_PHASES,
  deriveReadPerspective,
  deriveReadTransitionMechanism,
  observedRepresentation,
} from '../../../../src/state-calibration/index';
import {
  observeExchange,
  requireObservationDefinition,
} from '../../../../src/state-observation/index';
import { currentSlot, type CleanupCoordinator } from '../../../../src/test-data/index';

/**
 * Phase 4D — controlled LIVE state calibration.
 *
 * ## What this is
 *
 * The smallest live scenario that can establish what the real application exposes for the state
 * fields the State Model declares. It is **calibration, not validation**: it captures values and
 * records what they establish. There is not one assertion here about what a state SHOULD be.
 *
 * The only hard assertions are infrastructure preconditions — that the message was actually created
 * and that observations were actually captured. Without those the run would report "nothing
 * observed" and look like a clean result, which is precisely the vacuous green Phase 2A found
 * elsewhere in this repository.
 *
 * ## Why the sender is watched either side of the recipient's read
 *
 * The only way to see the recipient's side is to CALL the conversation read as the recipient — and
 * that call may itself be what marks the message read. Capturing the sender's view before and after
 * that call is what makes "the API read performed the transition" distinguishable from "it did not".
 * See `src/state-calibration/katchup-read.ts`.
 *
 * ## Safety
 *
 * Gated behind the existing `*_LIFECYCLE` flags, so it never runs on a default pass. It writes ONE
 * message between two accounts from the existing pool, tracked in the resource ledger the instant it
 * exists and deleted by the existing cleanup fixture whatever happens below. The Kall and KMail
 * calibrations are READ-ONLY: they observe whatever the account already has and create nothing.
 */

const [A, B] = currentSlot().principals(2) as [Principal, Principal];

const LIFECYCLE_OBSERVATION = 'katchup.message.lifecycle-via-conversation';
const READ_TIME_OBSERVATION = 'katchup.message.read-time-via-conversation';

/** Reads `as`'s 1:1 conversation with `withKpostId` and returns the exchange. */
async function conversation(
  endpoints: EndpointExecutor,
  as: Principal,
  withKpostId: string,
  label: string,
): ReturnType<EndpointExecutor['sendTo']> {
  return endpoints.sendTo(
    'katchup-conversation',
    { body: { groupFlag: false, firstMsgID: null, lastMsgID: null, receiver: withKpostId } },
    { label, auth: { principal: as } },
  );
}

/**
 * Captures both Katchup observations from one conversation read into the session.
 *
 * `actorRole` comes from the CALL, never from the response — the read-perspective question is
 * exactly what this scenario exists to settle, so nothing may presume it.
 */
function capture(
  session: CalibrationSession,
  exchange: Awaited<ReturnType<EndpointExecutor['sendTo']>>,
  observationId: string,
  phase: string,
  actorRole: ActorRoleId,
  testCaseId: string,
): void {
  const parsed = exchange.json();
  const body = parsed.ok ? parsed.value : undefined;
  const envelopeKeys =
    body !== null && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
  const observations = observeExchange(exchange, {
    observationId,
    runId: env.TEST_RUN_ID,
    testCaseId,
  });
  session.record(phase, observations, { actorRole });
  /*
   * Recorded even when nothing was found. A zero-observation result is ambiguous on its own — "the
   * account has no rows" and "the declared field path does not match this build" look identical —
   * and the envelope key NAMES (never values) are what tell them apart.
   */
  session.addAttempt({
    endpointId: requireObservationDefinition(observationId).endpointId,
    observationId,
    httpStatus: exchange.status,
    parsed: parsed.ok,
    envelopeKeys,
    observationCount: observations.length,
  });
}

function captureConversation(
  session: CalibrationSession,
  exchange: Awaited<ReturnType<EndpointExecutor['sendTo']>>,
  phase: string,
  actorRole: 'sender' | 'recipient',
  testCaseId: string,
): void {
  for (const observationId of [LIFECYCLE_OBSERVATION, READ_TIME_OBSERVATION]) {
    capture(session, exchange, observationId, phase, actorRole, testCaseId);
  }
}

/**
 * Persists the calibration result.
 *
 * A calibration whose result exists only in a test attachment is not a calibration — the point of
 * the phase is an artefact the State/Invariant layers can consume. Written under the existing
 * generated-reports convention (`reports/`, alongside `cases.jsonl` and `resources.jsonl`), which is
 * git-ignored. It contains observations and findings only: no response body, no credential.
 */
function persist(name: string, result: unknown): string {
  const dir = path.join(ROOT_DIR, 'reports', 'state-calibration');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');
  return file;
}

async function deleteMessage(
  endpoints: EndpointExecutor,
  as: Principal,
  msgID: number,
): Promise<number> {
  const exchange = await endpoints.sendTo(
    'katchup-delete-message',
    { body: { messageIds: [msgID], groupFlag: false } },
    { label: 'calibration:cleanup', auth: { principal: as }, allowLiveWrite: true },
  );
  return exchange.status;
}

test.describe('KPost state calibration · Katchup read', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    !env.KATCHUP_LIFECYCLE,
    'writes ONE real message; set KATCHUP_LIFECYCLE=true (owner sign-off, docs/katchup-flow.md §6)',
  );

  test('calibrate the Katchup read state and perspective @api @katchup @calibration', async ({
    endpoints,
    resources,
  }: {
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }, testInfo) => {
    const session = new CalibrationSession(
      'katchup.read-perspective',
      new Date().toISOString(),
      env.TEST_RUN_ID,
    );
    const marker = `state-calibration ${Date.now()}`;

    // ---- create the one resource this scenario needs -----------------------------------------
    const sent = await endpoints.sendTo(
      'katchup-send-message',
      {
        body: sendShape({
          sender: A.username,
          receiver: B.username,
          subject: 'State calibration',
          actualMessage: marker,
        }),
      },
      { label: 'calibration:send', auth: { principal: A }, allowLiveWrite: true },
    );
    const parsedSend = sent.json();
    const sentBody = (parsedSend.ok ? parsedSend.value : {}) as Record<string, unknown>;
    const sentRow = Array.isArray(sentBody.data)
      ? (sentBody.data[0] as Record<string, unknown> | undefined)
      : undefined;
    const msgID = typeof sentRow?.msgID === 'number' ? sentRow.msgID : undefined;

    // Infrastructure preconditions — NOT state expectations. Without a real message the rest of the
    // scenario would observe nothing and report a misleadingly clean result.
    expect(sent.status, 'the calibration message was accepted').toBeLessThan(300);
    expect(msgID, 'the send issued a msgID to calibrate against').toBeTruthy();
    if (msgID === undefined) return;

    resources.track({
      kind: 'katchup-message',
      id: msgID,
      describe: 'state calibration message',
      cleanup: () => deleteMessage(endpoints, A, msgID),
    });
    const resourceId = String(msgID);

    // The send response itself carries the initial row — recorded as its own phase.
    session.record(
      'sender:at-send',
      observeExchange(sent, {
        observationId: 'katchup.message.initial-state-via-send',
        runId: env.TEST_RUN_ID,
        testCaseId: testInfo.testId,
      }),
      { actorRole: 'sender' },
    );

    // ---- the controlled sequence ---------------------------------------------------------------
    captureConversation(
      session,
      await conversation(endpoints, A, B.username, 'calibration:sender-before'),
      KATCHUP_PHASES.senderBefore,
      'sender',
      testInfo.testId,
    );

    // This call may ITSELF be the read transition. That is the point of bracketing it.
    captureConversation(
      session,
      await conversation(endpoints, B, A.username, 'calibration:recipient-before'),
      KATCHUP_PHASES.recipientBefore,
      'recipient',
      testInfo.testId,
    );

    captureConversation(
      session,
      await conversation(endpoints, A, B.username, 'calibration:sender-after'),
      KATCHUP_PHASES.senderAfter,
      'sender',
      testInfo.testId,
    );

    captureConversation(
      session,
      await conversation(endpoints, B, A.username, 'calibration:recipient-after'),
      KATCHUP_PHASES.recipientAfter,
      'recipient',
      testInfo.testId,
    );

    // ---- derive, record, publish ----------------------------------------------------------------
    session.addFinding(deriveReadTransitionMechanism(session, resourceId));
    session.addFinding(deriveReadPerspective(session, resourceId));

    // The message must be findable in at least one observation, or the scenario observed a different
    // conversation than the one it created — an infrastructure fault, not an application finding.
    expect(
      session.select({ resourceId }).length,
      'the created message was observed at least once',
    ).toBeGreaterThan(0);

    persist('katchup', session.result());
    await testInfo.attach('state-calibration-katchup.json', {
      body: JSON.stringify(session.result(), null, 2),
      contentType: 'application/json',
    });
  });
});

test.describe('KPost state calibration · Kall representation (read-only)', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(!env.KALL_LIFECYCLE, 'live calibration read; set KALL_LIFECYCLE=true');

  test('calibrate the Kall status representation @api @kall @calibration', async ({
    endpoints,
  }: {
    endpoints: EndpointExecutor;
  }, testInfo) => {
    // Creates NOTHING. It observes whatever calls the account already has, so there is no resource
    // to clean up and no risk of ringing a device.
    const session = new CalibrationSession(
      'kall.status-representation',
      new Date().toISOString(),
      env.TEST_RUN_ID,
    );

    const exchange = await endpoints.sendTo(
      'kall-today-kool',
      {},
      { label: 'calibration:kall-today-kool', auth: { principal: A } },
    );

    for (const observationId of [
      'kall.status-via-today-kool',
      'kall.participant-state-via-today-kool',
    ]) {
      capture(session, exchange, observationId, 'kall:observe', 'call-caller', testInfo.testId);
    }

    session.addFinding(
      observedRepresentation(
        'kall.status-representation',
        session.select({ stateKey: 'senderKallStatus' }),
        'How this build represents the call status on kall-today-kool. CONF-KALL-STATUS-REPRESENTATION ' +
          'records that the workbook documents both a numeric senderKallStatus and a string kallStatus ' +
          'for this endpoint; this records only what came back.',
      ),
    );
    session.addFinding(
      observedRepresentation(
        'kall.participant-representation',
        session.select({ stateKey: 'receiverKallStatus' }),
        'How this build represents per-participant call status.',
      ),
    );

    /*
     * Only that a response was received. The STATUS is data, recorded in the attempt — an error
     * status means the calibration could not observe, which is an UNKNOWN finding, not a failed
     * test. Judging whether that status is correct belongs to the validators and the future
     * Business Invariant Model, never here.
     */
    expect(exchange.status, 'the Kall read received a response').toBeGreaterThan(0);
    persist('kall', session.result());
    await testInfo.attach('state-calibration-kall.json', {
      body: JSON.stringify(session.result(), null, 2),
      contentType: 'application/json',
    });
  });
});

test.describe('KPost state calibration · KMail transaction (read-only)', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(!env.KMAIL_LIFECYCLE, 'live calibration read; set KMAIL_LIFECYCLE=true');

  test('calibrate the KMail delivery/read representation @api @kmail @calibration', async ({
    endpoints,
  }: {
    endpoints: EndpointExecutor;
  }, testInfo) => {
    // Read-only: sentMailNotOpened reports mails ALREADY sent. It composes nothing and mails nobody.
    const session = new CalibrationSession(
      'kmail.transaction-representation',
      new Date().toISOString(),
      env.TEST_RUN_ID,
    );

    /*
     * The body is passed explicitly. `sendTo(id, {})` sends the LITERAL spec and never runs the
     * definition's request factory, so an empty object would post an empty body — which this
     * endpoint answers 400 to. Reporting that 400 as an observation about KMail would have been a
     * bench-payload artefact dressed up as application behaviour, the exact false-bug shape
     * CLAUDE.md §8 records as the validateOTP lesson.
     */
    const exchange = await endpoints.sendTo(
      'kmail-sent-not-opened',
      { body: { selectedContact: B.username } },
      { label: 'calibration:kmail-sent-not-opened', auth: { principal: A } },
    );

    capture(
      session,
      exchange,
      'kmail.transaction.unread-via-sent-not-opened',
      'kmail:observe',
      'sender',
      testInfo.testId,
    );

    session.addFinding(
      observedRepresentation(
        'kmail.transaction-representation',
        session.select({ stateKey: 'readStatus' }),
        'How this build represents per-recipient mail read state. CONF-KMAIL-RECEIPT-COVERAGE is ' +
          'unaffected by this observation: it concerns whether the receipt is COVERED, not how it is ' +
          'represented.',
      ),
    );

    // See the Kall note above: an error status is recorded, not asserted against.
    expect(exchange.status, 'the KMail read received a response').toBeGreaterThan(0);
    persist('kmail', session.result());
    await testInfo.attach('state-calibration-kmail.json', {
      body: JSON.stringify(session.result(), null, 2),
      contentType: 'application/json',
    });
  });
});
