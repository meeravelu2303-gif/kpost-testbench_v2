// Cross-account authorization (IDOR/BOLA) for Kall. Conditionals guard live setup.

import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { KALL_STATUS } from '@api/contract/kpost-types';
import { initiateShape } from '@api/definitions/kpost/kall/direct.api';
import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';
import { expect, test } from '@fixtures';

/**
 * Can an outsider end or change a call they are not party to? The writes take a bare `kallID`.
 * `updateKallStatus` answers SUCCESS regardless, so the verdict is the row's `sender_kall_status`.
 */
test.describe(
  'KPost Security · Kall call authorization (IDOR/BOLA) @api @kpost-api @security @kall @database',
  {
    tag: ['@api', '@kall', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
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
      const row = Array.isArray(data)
        ? (data[0] as Record<string, unknown> | undefined)
        : undefined;
      const obj =
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : undefined;
      const kallID = [obj?.kallID, obj?.id, row?.kallID, row?.id, body.kallID].find(
        (candidate) => typeof candidate === 'number',
      );

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
          {
            label: 'idor:kall-update-status',
            auth: { principal: attacker! },
            allowLiveWrite: true,
          },
        );
        const attackEnd = await endpoints.sendTo(
          'kall-end-individual',
          { body: { kallID } },
          {
            label: 'idor:kall-end-individual',
            auth: { principal: attacker! },
            allowLiveWrite: true,
          },
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
     * Accept (status 1) takes a separate code path (`updateConnectedKallStatus`) whose UPDATEs filter
     * only by kallID, then return the full call record, including its real `meetingLink`.
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
      const row = Array.isArray(data)
        ? (data[0] as Record<string, unknown> | undefined)
        : undefined;
      const obj =
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : undefined;
      const kallID = [obj?.kallID, obj?.id, row?.kallID, row?.id, body.kallID].find(
        (candidate) => typeof candidate === 'number',
      );

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
        // `id: 0` on purpose: only kallID gates the update, the participant-row id is not needed.
        const attackAccept = await endpoints.sendTo(
          'kall-update-status',
          { body: { id: 0, kallStatus: KALL_STATUS.connected, kallID: realKallId } },
          {
            label: 'idor:kall-accept-attack',
            auth: { principal: attacker! },
            allowLiveWrite: true,
          },
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
              "receive that call's real meeting link in the response.",
            expected:
              'the attack is refused; sender_kall_status is unchanged; no meetingLink returned',
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
            {
              label: 'idor:kall-accept-cleanup-end',
              auth: { principal: owner! },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
        await endpoints
          .sendTo(
            'kall-clear-by-ids',
            { body: { kallIds: [kallID] } },
            {
              label: 'idor:kall-accept-cleanup-clear',
              auth: { principal: owner! },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
      }
    });

    /**
     * Reschedule flips the ORIGINAL call's status 6 (Scheduled) -> 7 (ReScheduled) by kallID alone,
     * so an outsider naming someone else's kallID could mark it superseded.
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
      const row = Array.isArray(data)
        ? (data[0] as Record<string, unknown> | undefined)
        : undefined;
      const obj =
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : undefined;
      const kallID = [obj?.kallID, obj?.id, row?.kallID, row?.id, body.kallID].find(
        (candidate) => typeof candidate === 'number',
      );

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
          {
            label: 'idor:kall-reschedule-attack',
            auth: { principal: attacker! },
            allowLiveWrite: true,
          },
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
            expected: "the original call's sender_kall_status is unchanged",
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
            {
              label: 'idor:kall-reschedule-cleanup-owner-end',
              auth: { principal: owner! },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
        await endpoints
          .sendTo(
            'kall-clear-by-ids',
            { body: { kallIds: [realKallId] } },
            {
              label: 'idor:kall-reschedule-cleanup-owner-clear',
              auth: { principal: owner! },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
        if (attackerNewKallId) {
          await endpoints
            .sendTo(
              'kall-end-individual',
              { body: { kallID: attackerNewKallId } },
              {
                label: 'idor:kall-reschedule-cleanup-attacker-end',
                auth: { principal: attacker! },
                allowLiveWrite: true,
              },
            )
            .catch(() => undefined);
          await endpoints
            .sendTo(
              'kall-clear-by-ids',
              { body: { kallIds: [attackerNewKallId] } },
              {
                label: 'idor:kall-reschedule-cleanup-attacker-clear',
                auth: { principal: attacker! },
                allowLiveWrite: true,
              },
            )
            .catch(() => undefined);
        }
      }
    });

    /**
     * `getKallStatus` takes sender/receiver from the body (no JWT identity check), so an outsider
     * could read the call status between two other accounts.
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
          {
            label: 'idor:kall-getstatus-attack',
            auth: { principal: attacker! },
            allowLiveWrite: true,
          },
        );
        const attackJson = attack.json();
        const attackBody = (attackJson.ok ? attackJson.value : {}) as Record<string, unknown>;
        const attackText = attack.bodyText;
        // Any non-empty kallStatus returned to the outsider is the disclosure.
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
            {
              label: 'idor:kall-getstatus-cleanup-end',
              auth: { principal: owner! },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
        await endpoints
          .sendTo(
            'kall-clear-by-ids',
            { body: { kallIds: [kallID] } },
            {
              label: 'idor:kall-getstatus-cleanup-clear',
              auth: { principal: owner! },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
      }
    });
  },
);

/** Local copy of `feature.spec.ts`'s `extractKallId` (no cross-spec imports). */
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
 * `contactInfo` scopes to the caller's contacts only when `fetchType === "knownContact"`; otherwise
 * it may return any account's PII. A pure read, so not gated on `KALL_LIFECYCLE`.
 */
test.describe(
  'KPost Security · Kall contactInfo PII disclosure (IDOR/BOLA) @api @kpost-api @security @kall',
  {
    tag: ['@api', '@kall', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    const K = AUTH_PROFILES.kpost;
    const attacker = K.principals.find((p) => p.key === 'personal-3');
    const target = K.principals.find((p) => p.key === 'personal-5');

    test.skip(!attacker || !target, 'needs two distinct KPost principals');

    test("an outsider can fetch a non-contact's full PII via contactInfo by omitting fetchType @api @security", async ({
      endpoints,
    }) => {
      test.skip(
        !testData.personal5KpostId || testData.personal5KpostId.includes('qa.p5'),
        "needs a real QA_PERSONAL_5_KPOST_ID account not already in the attacker's contacts",
      );

      // --- Control: the safe path (fetchType "knownContact") for a non-contact ---
      const safe = await endpoints.sendTo(
        'kall-contact-info',
        { body: { contactID: target!.username, kallID: null, fetchType: 'knownContact' } },
        {
          label: 'idor:kall-contactinfo-safe',
          auth: { principal: attacker! },
          allowLiveRead: true,
        },
      );
      const safeJson = safe.json();
      const safeBody = (safeJson.ok ? safeJson.value : {}) as Record<string, unknown>;

      // --- Attack: omit fetchType, which skips the contact-relationship check ---
      const attack = await endpoints.sendTo(
        'kall-contact-info',
        { body: { contactID: target!.username, kallID: null } },
        {
          label: 'idor:kall-contactinfo-attack',
          auth: { principal: attacker! },
          allowLiveRead: true,
        },
      );
      const attackJson = attack.json();
      const attackBody = (attackJson.ok ? attackJson.value : {}) as Record<string, unknown>;
      const attackText = attack.bodyText;

      const dataObj = Array.isArray(attackBody.data)
        ? (attackBody.data[0] as Record<string, unknown> | undefined)
        : (attackBody.data as Record<string, unknown> | undefined);
      const leakedMobile =
        typeof dataObj?.mobileNumber === 'string' && dataObj.mobileNumber.trim().length > 0;

      if (leakedMobile) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kall-contact-info',
          ruleId: 'IDOR-kall-contactinfo-pii-disclosure',
          rule:
            "An account must not be able to fetch another account's PII (mobile number, etc.) via " +
            'contactInfo unless they are an established contact — the fetchType check must not be ' +
            'bypassable by simply omitting the field.',
          expected:
            'no PII returned for a non-contact when fetchType is omitted/not "knownContact"',
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
  },
);
