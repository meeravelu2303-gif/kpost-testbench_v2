// Cross-account authorization (IDOR/BOLA) for Kall. Conditionals guard live setup.
/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { KALL_STATUS } from '@api/schemas/kpost-types';
import { initiateShape } from '@api/definitions/kpost/kall/direct.api';
import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';
import { expect, test } from '@fixtures';

/**
 * Can an outsider end or change the status of a call they are neither the sender nor the receiver
 * of? `updateKallStatus`/`endIndividualKall` take a bare `kallID` and nothing else that ties it to
 * the caller — the same object-handle shape that made `removeGroupMember` exploitable (Bugzilla
 * #507) and that this bench already proved safe for Katchup's recall/delete. Kall had zero IDOR
 * coverage of any kind before this (confirmed: 0/20 endpoints, see the 2026-10-03 ground-truth
 * re-audit) despite several of its writes being exactly this shape.
 *
 * ## The database is the judge
 *
 * `updateKallStatus` answers SUCCESS regardless, so the verdict is the row: after the outsider's
 * attempt, the call's `sender_kall_status` in `TBL_KPOST_KOOL_KALL_MASTER` must be unchanged.
 */
test.describe('KPost Security · Kall call authorization (IDOR/BOLA) @api @kpost-api @security @kall @database', () => {
  const K = AUTH_PROFILES.kpost;
  const owner = K.principals.find((p) => p.key === 'personal');
  const receiver = K.principals.find((p) => p.key === 'victim');
  const attacker = K.principals.find((p) => p.key === 'personal-3');

  test.skip(!owner || !receiver || !attacker, 'needs three distinct KPost principals');
  test.skip(process.env.KALL_LIFECYCLE !== 'true', 'places a real call; set KALL_LIFECYCLE=true');

  test('an outsider cannot change the status of a call they are not party to @api @security', async ({
    endpoints,
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

    // --- Setup: the owner places a call to the receiver -------------------------------------------
    const placed = await endpoints.sendTo(
      'kall-initiate',
      { body: initiateShape({ receiver: receiver!.username }) },
      { label: 'idor:kall-initiate', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const parsed = placed.json();
    const body = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
    const data = body.data;
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    const obj =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : undefined;
    const kallID = [obj?.kallID, obj?.id, row?.kallID, row?.id, body.kallID].find(
      (candidate) => typeof candidate === 'number',
    ) as number | undefined;

    // No kallID means initiate didn't create one; skip with a reason rather than failing.
    test.skip(
      !kallID,
      `kall-initiate did not return a kallID to attack (placed replied ${placed.status})`,
    );

    const realKallId = kallID as number;

    try {
      const before = await database.findOne<{ sender_kall_status: number }>({
        table: 'TBL_KPOST_KOOL_KALL_MASTER',
        where: { kall_id: realKallId },
      });

      // --- Attack: the outsider tries to cancel and then end the owner's call -------------------
      const attackCancel = await endpoints.sendTo(
        'kall-update-status',
        { body: { id: kallID, kallStatus: KALL_STATUS.cancelled, kallID } },
        { label: 'idor:kall-update-status', auth: { principal: attacker! }, allowLiveWrite: true },
      );
      const attackEnd = await endpoints.sendTo(
        'kall-end-individual',
        { body: { kallID } },
        { label: 'idor:kall-end-individual', auth: { principal: attacker! }, allowLiveWrite: true },
      );

      const after = await database.findOne<{ sender_kall_status: number }>({
        table: 'TBL_KPOST_KOOL_KALL_MASTER',
        where: { kall_id: realKallId },
      });

      expect
        .soft(
          after?.sender_kall_status ?? before?.sender_kall_status,
          `BOLA: an outsider must not change a call they are not party to ` +
            `(updateKallStatus replied ${attackCancel.status}, endIndividualKall replied ${attackEnd.status})`,
        )
        .toBe(before?.sender_kall_status);
    } finally {
      // Cleanup: the owner ends and clears their own call so nothing is left dangling.
      await endpoints
        .sendTo(
          'kall-end-individual',
          { body: { kallID } },
          { label: 'idor:kall-cleanup-end', auth: { principal: owner! }, allowLiveWrite: true },
        )
        .catch(() => undefined);
      await endpoints
        .sendTo(
          'kall-clear-by-ids',
          { body: { kallIds: [kallID] } },
          { label: 'idor:kall-cleanup-clear', auth: { principal: owner! }, allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
  });

  /**
   * The accept path specifically — `kallStatus: KALL_STATUS.connected` (1) — is a DIFFERENT code path
   * from the cancel/decline branches the test above exercises: `KallServiceImplV3.updateKallStatus`
   * routes status 1 to `updateConnectedKallStatus` instead of the normal, correctly sender/receiver
   * -scoped `updateKallStatus` DAO method. That method's two UPDATEs filter ONLY by `id`/`kallID` —
   * no `and sender=:sender`/`and receiver=:receiver` guard at all (2026-10-04 ground-truth audit,
   * `KallDaoImplV3.java:567-600`) — unlike every sibling status-write in the same file. As soon as
   * either UPDATE affects a row, it unconditionally fetches and returns the full `KallMaster` record
   * by bare `kallID`, which — per `KpostWelcomeMailAndMessage.modifyKallResponse()` — includes the
   * real `meetingLink` for that call. So an outsider who merely knows/guesses a `kallID` can both (a)
   * read back the real join link for a call they were never invited to, and (b) flip that call's real
   * status as a side effect, with no relationship to the call required at all.
   */
  test('an outsider "accepting" a call they are not party to gets back the real meeting link @api @security', async ({
    endpoints,
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

    // --- Setup: the owner places a call to the receiver -------------------------------------------
    const placed = await endpoints.sendTo(
      'kall-initiate',
      { body: initiateShape({ receiver: receiver!.username }) },
      { label: 'idor:kall-accept-initiate', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const parsed = placed.json();
    const body = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
    const data = body.data;
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    const obj =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : undefined;
    const kallID = [obj?.kallID, obj?.id, row?.kallID, row?.id, body.kallID].find(
      (candidate) => typeof candidate === 'number',
    ) as number | undefined;

    test.skip(
      !kallID,
      `kall-initiate did not return a kallID to attack (placed replied ${placed.status})`,
    );
    const realKallId = kallID as number;

    try {
      const before = await database.findOne<{ sender_kall_status: number }>({
        table: 'TBL_KPOST_KOOL_KALL_MASTER',
        where: { kall_id: realKallId },
      });

      // --- Attack: the outsider "accepts" a call that was never addressed to them -----------------
      // `id` deliberately left as an arbitrary value (0) — per source, only `kallID` gates the
      // KallMaster update that triggers the leaked-record fetch; the real participant-row id is not
      // required at all, which is itself part of the finding (no "you must also know this" barrier).
      const attackAccept = await endpoints.sendTo(
        'kall-update-status',
        { body: { id: 0, kallStatus: KALL_STATUS.connected, kallID: realKallId } },
        { label: 'idor:kall-accept-attack', auth: { principal: attacker! }, allowLiveWrite: true },
      );

      const attackJson = attackAccept.json();
      const attackBody = (attackJson.ok ? attackJson.value : {}) as Record<string, unknown>;
      const attackText = attackAccept.bodyText;
      const leakedMeetingLink =
        attackText.toLowerCase().includes('meetinglink') &&
        !attackText.toLowerCase().includes('"meetinglink":null') &&
        !attackText.toLowerCase().includes('"meetinglink":""');

      const after = await database.findOne<{ sender_kall_status: number }>({
        table: 'TBL_KPOST_KOOL_KALL_MASTER',
        where: { kall_id: realKallId },
      });
      const statusCorrupted = after?.sender_kall_status !== before?.sender_kall_status;

      if (leakedMeetingLink || statusCorrupted) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kall-update-status',
          ruleId: 'IDOR-kall-accept-meeting-link-disclosure',
          rule:
            'An outsider must not be able to "accept" a call they are not party to, and must not ' +
            'receive that call\'s real meeting link in the response.',
          expected: 'the attack is refused; sender_kall_status is unchanged; no meetingLink returned',
          actual:
            `status=${attackAccept.status}, ok=${attackJson.ok}, meetingLink leaked=${leakedMeetingLink}, ` +
            `sender_kall_status before=${before?.sender_kall_status} after=${after?.sender_kall_status} ` +
            `(kallID ${kallID}, owner ${owner!.username}, receiver ${receiver!.username}, attacker ${attacker!.username})`,
          request: { body: { id: 0, kallStatus: KALL_STATUS.connected, kallID } },
        });
      }

      expect
        .soft(
          leakedMeetingLink,
          `BOLA: an outsider's "accept" response must not contain the real meeting link ` +
            `(updateKallStatus replied ${attackAccept.status})`,
        )
        .toBe(false);
      expect
        .soft(
          statusCorrupted,
          `BOLA: an outsider's "accept" attempt must not change sender_kall_status on a call they ` +
            `are not party to (was ${before?.sender_kall_status}, now ${after?.sender_kall_status})`,
        )
        .toBe(false);

      test.info().annotations.push({
        type: 'observed',
        description: `raw attack response (truncated): ${attackText.slice(0, 500)}`,
      });
      void attackBody;
    } finally {
      // Cleanup: the owner ends and clears their own call so nothing is left dangling, and restores
      // the status if the attack corrupted it.
      await endpoints
        .sendTo(
          'kall-end-individual',
          { body: { kallID } },
          { label: 'idor:kall-accept-cleanup-end', auth: { principal: owner! }, allowLiveWrite: true },
        )
        .catch(() => undefined);
      await endpoints
        .sendTo(
          'kall-clear-by-ids',
          { body: { kallIds: [kallID] } },
          { label: 'idor:kall-accept-cleanup-clear', auth: { principal: owner! }, allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
  });

  /**
   * `reScheduleKall` creates a NEW call (by design — BR-C01, see `feature.spec.ts`) but also flips the
   * ORIGINAL call's own `senderKallStatus` 6 (Scheduled) -> 7 (ReScheduled), to mark it superseded.
   * Per the 2026-10-04 ground-truth audit, `KallDaoImplV3.reschedulekall` (lines ~451-464) does this
   * with NO sender/receiver guard at all — only the original `kallID` named in the request body. So
   * an outsider can flip the status of someone ELSE's real scheduled call to "ReScheduled" just by
   * naming it in their own reschedule request, corrupting data they have no relationship to.
   */
  test('an outsider cannot mark someone else\'s scheduled call as "Rescheduled" @api @security', async ({
    endpoints,
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

    // --- Setup: the owner schedules a real Kool Kall to the receiver ---------------------------
    const scheduled = await endpoints.sendTo(
      'kall-scheduled',
      { body: scheduleShape({ kallDetails: [{ receiver: receiver!.username }] }) },
      { label: 'idor:kall-reschedule-setup', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const parsed = scheduled.json();
    const body = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
    const data = body.data;
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    const obj =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : undefined;
    const kallID = [obj?.kallID, obj?.id, row?.kallID, row?.id, body.kallID].find(
      (candidate) => typeof candidate === 'number',
    ) as number | undefined;

    test.skip(
      !kallID,
      `kall-scheduled did not return a kallID to attack (scheduled replied ${scheduled.status})`,
    );
    const realKallId = kallID as number;
    let attackerNewKallId: number | undefined;

    try {
      const before = await database.findOne<{ sender_kall_status: number }>({
        table: 'TBL_KPOST_KOOL_KALL_MASTER',
        where: { kall_id: realKallId },
      });

      // --- Attack: the outsider "reschedules" a call that was never theirs, naming the owner's
      // real kallID but supplying the ATTACKER's own (innocuous) new schedule details -------------
      const attack = await endpoints.sendTo(
        'kall-reschedule',
        {
          body: scheduleShape({
            kallID: realKallId,
            kallDetails: [{ receiver: receiver!.username }],
          }),
        },
        { label: 'idor:kall-reschedule-attack', auth: { principal: attacker! }, allowLiveWrite: true },
      );
      const attackJson = attack.json();
      const attackBody = (attackJson.ok ? attackJson.value : {}) as Record<string, unknown>;
      attackerNewKallId = extractKallIdLoose(attackBody);

      const after = await database.findOne<{ sender_kall_status: number }>({
        table: 'TBL_KPOST_KOOL_KALL_MASTER',
        where: { kall_id: realKallId },
      });
      const statusCorrupted = after?.sender_kall_status !== before?.sender_kall_status;

      if (statusCorrupted) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kall-reschedule',
          ruleId: 'IDOR-kall-reschedule-status-corruption',
          rule:
            'An outsider must not be able to flip the status of a scheduled call they are not party ' +
            'to, by naming its kallID in their own reschedule request.',
          expected: 'the original call\'s sender_kall_status is unchanged',
          actual:
            `status=${attack.status}, ok=${attackJson.ok}, sender_kall_status before=` +
            `${before?.sender_kall_status} after=${after?.sender_kall_status} (kallID ${realKallId}, ` +
            `owner ${owner!.username}, receiver ${receiver!.username}, attacker ${attacker!.username})`,
          request: { body: { kallID: realKallId } },
        });
      }

      expect
        .soft(
          statusCorrupted,
          `BOLA: an outsider's reschedule attempt must not change the status of a call they are not ` +
            `party to (was ${before?.sender_kall_status}, now ${after?.sender_kall_status})`,
        )
        .toBe(false);
    } finally {
      // Cleanup: both the owner's original call and any new call the attacker's reschedule created.
      await endpoints
        .sendTo(
          'kall-end-individual',
          { body: { kallID: realKallId } },
          { label: 'idor:kall-reschedule-cleanup-owner-end', auth: { principal: owner! }, allowLiveWrite: true },
        )
        .catch(() => undefined);
      await endpoints
        .sendTo(
          'kall-clear-by-ids',
          { body: { kallIds: [realKallId] } },
          { label: 'idor:kall-reschedule-cleanup-owner-clear', auth: { principal: owner! }, allowLiveWrite: true },
        )
        .catch(() => undefined);
      if (attackerNewKallId) {
        await endpoints
          .sendTo(
            'kall-end-individual',
            { body: { kallID: attackerNewKallId } },
            { label: 'idor:kall-reschedule-cleanup-attacker-end', auth: { principal: attacker! }, allowLiveWrite: true },
          )
          .catch(() => undefined);
        await endpoints
          .sendTo(
            'kall-clear-by-ids',
            { body: { kallIds: [attackerNewKallId] } },
            { label: 'idor:kall-reschedule-cleanup-attacker-clear', auth: { principal: attacker! }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    }
  });

  /**
   * `getKallStatus` answers "what is the status of the call between THIS sender and THIS receiver"
   * purely from the request body — `KallControllerV3.java:900-914` has its JWT-identity-override line
   * literally commented out, so an authenticated caller can name ANY two other kpostIDs as
   * sender/receiver and ask whether/how they are connected on a given kallID, without being either
   * party. The underlying query itself is correctly scoped by (sender, receiver, kallID) together —
   * this is not a raw content leak — but it is a cross-tenant STATUS disclosure: an outsider can
   * confirm two strangers' real call state on a call they have no part in.
   */
  test('an outsider can query the status of a call between two OTHER accounts @api @security', async ({
    endpoints,
  }) => {
    // --- Setup: the owner places a real call to the receiver -----------------------------------
    const placed = await endpoints.sendTo(
      'kall-initiate',
      { body: initiateShape({ receiver: receiver!.username }) },
      { label: 'idor:kall-getstatus-setup', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const parsed = placed.json();
    const body = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
    const kallID = extractKallIdLoose(body);
    test.skip(
      !kallID,
      `kall-initiate did not return a kallID to attack (placed replied ${placed.status})`,
    );

    try {
      // --- Attack: the outsider asks for the status of a call between the OTHER two accounts ----
      const attack = await endpoints.sendTo(
        'kall-get-status',
        { body: { sender: owner!.username, receiver: receiver!.username, kallID } },
        { label: 'idor:kall-getstatus-attack', auth: { principal: attacker! }, allowLiveWrite: true },
      );
      const attackJson = attack.json();
      const attackBody = (attackJson.ok ? attackJson.value : {}) as Record<string, unknown>;
      const attackText = attack.bodyText;
      // The real finding: the endpoint answers with the call's actual kallStatus (e.g. "busy",
      // "connected") for two accounts the caller is neither of — a non-empty, non-error kallStatus
      // value is the disclosure, regardless of whether the response happens to echo the kallID back.
      const statusValue = attackBody.kallStatus;
      const disclosed =
        attack.status < 300 &&
        attackJson.ok &&
        typeof statusValue === 'string' &&
        statusValue.trim().length > 0;

      if (disclosed) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kall-get-status',
          ruleId: 'IDOR-kall-getstatus-cross-tenant-disclosure',
          rule:
            'An outsider must not be able to query the call status between two other accounts by ' +
            'naming them in the request body — the real caller identity is never checked.',
          expected: 'the outsider gets no usable call-status data back',
          actual: `status=${attack.status}, ok=${attackJson.ok}, response names kallID ${kallID}: ${attackText.slice(0, 300)}`,
          request: { body: { sender: owner!.username, receiver: receiver!.username, kallID } },
        });
      }

      expect
        .soft(
          disclosed,
          `BOLA: an outsider must not be able to query the status of a call between two other ` +
            `accounts (getKallStatus replied ${attack.status})`,
        )
        .toBe(false);
    } finally {
      await endpoints
        .sendTo(
          'kall-end-individual',
          { body: { kallID } },
          { label: 'idor:kall-getstatus-cleanup-end', auth: { principal: owner! }, allowLiveWrite: true },
        )
        .catch(() => undefined);
      await endpoints
        .sendTo(
          'kall-clear-by-ids',
          { body: { kallIds: [kallID] } },
          { label: 'idor:kall-getstatus-cleanup-clear', auth: { principal: owner! }, allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
  });
});

/** Same shape as `feature.spec.ts`'s private `extractKallId`, duplicated locally to avoid a cross-file import of a test-only helper. */
function extractKallIdLoose(body: Record<string, unknown>): number | undefined {
  const data = body.data;
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  const obj =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  for (const candidate of [obj?.kallID, obj?.id, row?.kallID, row?.id, body.kallID]) {
    if (typeof candidate === 'number') return candidate;
  }
  return undefined;
}

/**
 * `contactInfo` PII disclosure via a non-"knownContact" `fetchType` — a pure read, places no call,
 * so this does not need `KALL_LIFECYCLE` (own describe block, ungated).
 *
 * Per the 2026-10-04 ground-truth audit: `KallServiceImplV3.ContactInfo()` (lines ~500-572) only
 * scopes its lookup by the caller's own contact list when `fetchType === "knownContact"` (via
 * `contactRepository.getKallContactDetails(kpostID, contactID)`). For ANY other `fetchType` value —
 * including simply omitting the field, which is what this endpoint's own default bench payload
 * already does — it instead does an unscoped `signUpLoginRepository.findByKpostID(contactID)` and
 * returns full PII (mobile number, landline, alternate mobile, country code, full name, user type)
 * for whatever `contactID` is named, with no check that the caller actually knows/has that contact.
 */
test.describe('KPost Security · Kall contactInfo PII disclosure (IDOR/BOLA) @api @kpost-api @security @kall', () => {
  const K = AUTH_PROFILES.kpost;
  const attacker = K.principals.find((p) => p.key === 'personal-3');
  const target = K.principals.find((p) => p.key === 'personal-5');

  test.skip(!attacker || !target, 'needs two distinct KPost principals');

  test('an outsider can fetch a non-contact\'s full PII via contactInfo by omitting fetchType @api @security', async ({
    endpoints,
  }) => {
    test.skip(
      !testData.personal5KpostId || testData.personal5KpostId.includes('qa.p5'),
      'needs a real QA_PERSONAL_5_KPOST_ID account not already in the attacker\'s contacts',
    );

    // --- Control: the SAFE path — fetchType: "knownContact" against a non-contact should disclose
    // nothing useful (the attacker and the target have no established contact relationship). ---
    const safe = await endpoints.sendTo(
      'kall-contact-info',
      { body: { contactID: target!.username, kallID: null, fetchType: 'knownContact' } },
      { label: 'idor:kall-contactinfo-safe', auth: { principal: attacker! }, allowLiveRead: true },
    );
    const safeJson = safe.json();
    const safeBody = (safeJson.ok ? safeJson.value : {}) as Record<string, unknown>;

    // --- Attack: the VULNERABLE path — omit fetchType entirely (this endpoint's own default bench
    // payload already does this), which per source skips the contact-relationship check. ---
    const attack = await endpoints.sendTo(
      'kall-contact-info',
      { body: { contactID: target!.username, kallID: null } },
      { label: 'idor:kall-contactinfo-attack', auth: { principal: attacker! }, allowLiveRead: true },
    );
    const attackJson = attack.json();
    const attackBody = (attackJson.ok ? attackJson.value : {}) as Record<string, unknown>;
    const attackText = attack.bodyText;

    const dataObj = Array.isArray(attackBody.data)
      ? (attackBody.data[0] as Record<string, unknown> | undefined)
      : (attackBody.data as Record<string, unknown> | undefined);
    const leakedMobile =
      typeof dataObj?.mobileNumber === 'string' && (dataObj.mobileNumber as string).trim().length > 0;

    if (leakedMobile) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'kall-contact-info',
        ruleId: 'IDOR-kall-contactinfo-pii-disclosure',
        rule:
          'An account must not be able to fetch another account\'s PII (mobile number, etc.) via ' +
          'contactInfo unless they are an established contact — the fetchType check must not be ' +
          'bypassable by simply omitting the field.',
        expected: 'no PII returned for a non-contact when fetchType is omitted/not "knownContact"',
        actual:
          `safe-path (knownContact) response=${JSON.stringify(safeBody).slice(0, 200)}; ` +
          `attack-path (no fetchType) leaked mobileNumber for ${target!.username}: ${attackText.slice(0, 400)}`,
        request: { body: { contactID: target!.username, kallID: null } },
      });
    }

    expect
      .soft(
        leakedMobile,
        `BOLA: contactInfo must not disclose ${target!.username}'s PII to an account with no ` +
          `established contact relationship, just by omitting fetchType (replied ${attack.status})`,
      )
      .toBe(false);
  });
});
