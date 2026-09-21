import type { CalibrationFinding, CalibrationRecord } from './calibration-result';
import type { CalibrationSession } from './session';

/**
 * Deriving what a controlled Katchup read scenario established.
 *
 * Pure: these functions read a recorded session and return findings. They perform no call, assert
 * nothing, and never mutate the session.
 *
 * ## The methodological hazard these derivations are built around
 *
 * The obvious scenario — "have the recipient read, then look" — has a trap in it. The only way the
 * bench can look at the recipient's side is to CALL the conversation read as the recipient, and the
 * web client marks a thread read as a side effect of opening the conversation. So the act of
 * observing may itself be the transition, and a naive scenario would record a read it caused and
 * report it as a read the recipient performed.
 *
 * The scenario therefore captures the SENDER's view either side of the recipient's first API call,
 * which makes the two cases distinguishable:
 *
 *   sender's view changed after the recipient's API read only   → the API read performs the transition
 *   sender's view unchanged                                     → the API read does NOT perform it,
 *                                                                 and a UI read is required
 *
 * Both outcomes are informative and neither is a failure.
 */

/** The phase names the Katchup scenario records. Shared so the spec and the derivations agree. */
export const KATCHUP_PHASES = {
  senderBefore: 'sender:before',
  recipientBefore: 'recipient:before-api-read',
  senderAfter: 'sender:after-recipient-api-read',
  recipientAfter: 'recipient:after-api-read',
} as const;

const STATUS = 'status';
const READ_TIME = 'readTime';

interface Snapshot {
  readonly status?: CalibrationRecord;
  readonly readTime?: CalibrationRecord;
}

function snapshot(session: CalibrationSession, phase: string, resourceId: string): Snapshot {
  const status = session.select({ phase, stateKey: STATUS, resourceId })[0];
  const readTime = session.select({ phase, stateKey: READ_TIME, resourceId })[0];
  return {
    ...(status ? { status } : {}),
    ...(readTime ? { readTime } : {}),
  };
}

const describe = (record: CalibrationRecord | undefined): string =>
  record
    ? `${record.observation.stateKey}=${JSON.stringify(record.observation.rawValue)} (${record.observation.presence})`
    : '(not captured)';

/** Whether two records differ in presence or raw value. `undefined` on either side means unknown. */
function changed(before?: CalibrationRecord, after?: CalibrationRecord): boolean | undefined {
  if (!before || !after) return undefined;
  if (before.observation.presence !== after.observation.presence) return true;
  return JSON.stringify(before.observation.rawValue) !== JSON.stringify(after.observation.rawValue);
}

function evidenceOf(...records: (CalibrationRecord | undefined)[]): CalibrationRecord[] {
  return records.filter((record): record is CalibrationRecord => record !== undefined);
}

/**
 * What the scenario established about the mechanism that performs the read transition.
 *
 * This is derived FIRST because the perspective question depends on it: if nothing moved, there is
 * no transition to have a perspective about.
 */
export function deriveReadTransitionMechanism(
  session: CalibrationSession,
  resourceId: string,
): CalibrationFinding {
  const before = snapshot(session, KATCHUP_PHASES.senderBefore, resourceId);
  const after = snapshot(session, KATCHUP_PHASES.senderAfter, resourceId);
  const evidence = evidenceOf(before.status, before.readTime, after.status, after.readTime);

  const statusMoved = changed(before.status, after.status);
  const readTimeMoved = changed(before.readTime, after.readTime);

  if (statusMoved === undefined && readTimeMoved === undefined) {
    return {
      subject: 'katchup.message.read-transition-mechanism',
      verdict: 'UNKNOWN',
      statement:
        'The sender-side observations either side of the recipient’s API conversation read were not ' +
        'both captured, so nothing can be concluded about what performs the read transition.',
      evidence,
      whatWouldResolve:
        `Capture ${STATUS} and ${READ_TIME} for the message in both ` +
        `"${KATCHUP_PHASES.senderBefore}" and "${KATCHUP_PHASES.senderAfter}".`,
      bearsOnConflicts: ['CONF-KATCHUP-READ-PERSPECTIVE'],
    };
  }

  if (statusMoved === true || readTimeMoved === true) {
    return {
      subject: 'katchup.message.read-transition-mechanism',
      verdict: 'CONFLICTED',
      statement:
        'Calling katchup-conversation as the RECIPIENT changed what the sender subsequently sees ' +
        `(${describe(before.status)} → ${describe(after.status)}; ` +
        `${describe(before.readTime)} → ${describe(after.readTime)}). ` +
        'On this evidence the recipient’s conversation READ performs the read transition, with no UI ' +
        'involved — which contradicts the Phase 4B transition record, where katchup.message.read is ' +
        'declared mechanism UI on the grounds that no endpoint marks a 1:1 message read.',
      evidence,
      limitation:
        'It establishes that SOMETHING between the two sender observations moved the state, and the ' +
        'only intervening call was the recipient’s conversation read. It does not establish that the ' +
        'endpoint is documented or intended to do so.',
      bearsOnConflicts: ['CONF-KATCHUP-READ-PERSPECTIVE'],
    };
  }

  return {
    subject: 'katchup.message.read-transition-mechanism',
    verdict: 'UNKNOWN',
    statement:
      'Calling katchup-conversation as the recipient did NOT change what the sender sees ' +
      `(${describe(before.status)} unchanged; ${describe(before.readTime)} unchanged). ` +
      'The API read therefore does not perform the read transition, which is consistent with the ' +
      'Phase 4B record that the transition is UI-driven. What actually performs it remains unobserved.',
    evidence,
    whatWouldResolve:
      'Drive the recipient’s read through the UI (open the conversation in a browser session for ' +
      'the recipient account), then re-capture the sender-side observation. Note that a UI login ' +
      'displaces the recipient’s API session, so the API observation must be re-authenticated after.',
    bearsOnConflicts: ['CONF-KATCHUP-READ-PERSPECTIVE'],
  };
}

/**
 * What the scenario established about WHOSE read state the fields represent.
 *
 * The Phase 4A/4B question, deliberately left open until live evidence settles it. This derivation
 * only ever returns `CONFIRMED_REPRESENTATION` when the observations actually rule out the
 * alternative; otherwise it returns `UNKNOWN` and says what is still missing.
 */
export function deriveReadPerspective(
  session: CalibrationSession,
  resourceId: string,
): CalibrationFinding {
  const senderBefore = snapshot(session, KATCHUP_PHASES.senderBefore, resourceId);
  const senderAfter = snapshot(session, KATCHUP_PHASES.senderAfter, resourceId);
  const recipientBefore = snapshot(session, KATCHUP_PHASES.recipientBefore, resourceId);
  const recipientAfter = snapshot(session, KATCHUP_PHASES.recipientAfter, resourceId);

  const evidence = evidenceOf(
    senderBefore.status,
    senderBefore.readTime,
    recipientBefore.status,
    recipientBefore.readTime,
    senderAfter.status,
    senderAfter.readTime,
    recipientAfter.status,
    recipientAfter.readTime,
  );

  const senderMoved = changed(senderBefore.status, senderAfter.status);
  const senderTimeMoved = changed(senderBefore.readTime, senderAfter.readTime);

  if (senderMoved === undefined && senderTimeMoved === undefined) {
    return {
      subject: 'katchup.message.read-perspective',
      verdict: 'UNKNOWN',
      statement:
        'The sender-side before/after pair was not captured, so whose read state status/readTime ' +
        'represent remains exactly as unresolved as Phase 4B recorded it.',
      evidence,
      whatWouldResolve:
        'Complete the controlled scenario: sender observes, recipient reads, sender observes again.',
      bearsOnConflicts: ['CONF-KATCHUP-READ-PERSPECTIVE'],
    };
  }

  if (senderMoved !== true && senderTimeMoved !== true) {
    return {
      subject: 'katchup.message.read-perspective',
      verdict: 'UNKNOWN',
      statement:
        'Nothing the sender can see changed during the scenario, so no read transition was ' +
        'witnessed and the perspective question cannot be answered from these observations. The ' +
        'Phase 4B UNKNOWN stands, unchanged.',
      evidence,
      limitation:
        'This says nothing about whether the field COULD carry the recipient’s read state; it says ' +
        'only that no read was observed to occur during this scenario.',
      whatWouldResolve:
        'A scenario in which the recipient’s read demonstrably happens — see the ' +
        'read-transition-mechanism finding for what to drive.',
      bearsOnConflicts: ['CONF-KATCHUP-READ-PERSPECTIVE'],
    };
  }

  return {
    subject: 'katchup.message.read-perspective',
    verdict: 'CONFIRMED_REPRESENTATION',
    statement:
      'The SENDER’s view of the message changed after the recipient read it ' +
      `(${describe(senderBefore.status)} → ${describe(senderAfter.status)}; ` +
      `${describe(senderBefore.readTime)} → ${describe(senderAfter.readTime)}). ` +
      'status/readTime on the 1:1 conversation read are therefore NOT a private per-caller view: ' +
      'the sender can observe that the recipient has read the message, which is what FR-K07 requires. ' +
      `For comparison, the recipient’s own view at the same points was ` +
      `${describe(recipientBefore.status)} then ${describe(recipientAfter.status)}.`,
    evidence,
    limitation:
      'Established for a 1:1 message only. It does not establish the behaviour for group messages, ' +
      'where status 4 (Group) occupies the same field, and it does not establish that readTime is ' +
      'the recipient’s clock rather than the server’s.',
    bearsOnConflicts: ['CONF-KATCHUP-READ-PERSPECTIVE'],
  };
}

/** A plain OBSERVED record of a representation, for fields the scenario merely captures. */
export function observedRepresentation(
  subject: string,
  records: readonly CalibrationRecord[],
  note: string,
): CalibrationFinding {
  const values = records
    .map(
      (record) => `${record.observation.stateKey}=${JSON.stringify(record.observation.rawValue)}`,
    )
    .join(', ');
  return {
    subject,
    verdict: records.length > 0 ? 'OBSERVED' : 'UNKNOWN',
    statement:
      records.length > 0 ? `${note} Observed: ${values}.` : `${note} Nothing was captured.`,
    evidence: [...records],
  };
}
