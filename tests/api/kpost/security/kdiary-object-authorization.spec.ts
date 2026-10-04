// KDiary cross-tenant IDOR — getEventDate (read) and updateEvent (disclosure + unauthorized touch).
// Gated: creates/deletes a real diary event on principal A's own account via the standard
// KDIARY_LIFECYCLE write path.
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { scheduleShape } from '@api/definitions/kpost/kdiary/write.api';
import { expect, test } from '@fixtures';

/**
 * Per the 2026-10-04 KDiary ground-truth audit (independently re-verified by direct source reading of
 * `KdiaryScheduleController.java` lines 194-295, `KdiaryScheduleServiceImpl.java` lines 215-233 and
 * 278-279, `KdiaryRO.java` line 18, and `KdiaryScheduleRepository.java` line 36), neither
 * `getEventDate` nor `updateEvent` ever reads `request.getAttribute("kpostID")` — both look a diary
 * event up by the body's own `eventID`/`eventIds` with no ownership check at all.
 *
 * `getEventDate` (`kdiaryScheduleRepository.findByEventIDIn`) maps the full row (title, description,
 * start/end time, remarks) into the response for ANY eventIds, owned or not — CONFIRMED live below.
 *
 * `updateEvent`'s content-mutation surface was initially overclaimed from source alone: the service
 * method (lines 215-233) reads `isRepeat`/`isDaily`/`isWeekly`/`isMonthly` off the body and, on paper,
 * reassigns the event's recurrence `type` accordingly. A **live run disproved this** — three
 * consecutive attempts with a correctly-serialized `{repeat:true, daily:true}` body (confirmed via a
 * debug annotation of the literal outgoing JSON) left the victim's `type` unchanged at `0`, meaning the
 * deployed server does not behave exactly like this local checkout's source for that branch. What DID
 * reproduce live, every time: (1) `updateEvent`'s own 200 response body discloses the full victim event
 * (same disclosure as `getEventDate`, just reached through a write endpoint), and (2) the victim's
 * `modifiedDate` audit column silently changes as a side effect of a write issued by a wholly unrelated
 * caller — an unauthorized touch with no real content change, but still evidence the row was saved on
 * an unrelated caller's say-so. Both still trace to the identical missing-ownership-check root cause as
 * `getEventDate`, just with a narrower confirmed blast radius than first suspected.
 *
 * A is the event owner; C is a wholly unrelated principal who should never see or touch A's event.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;

function extractId(bodyObj: Record<string, unknown>): number | undefined {
  const data = bodyObj.data;
  const obj = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<
    string,
    unknown
  >;
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  for (const c of [obj.eventID, obj.id, row?.eventID, row?.id]) {
    if (typeof c === 'number') return c;
  }
  return undefined;
}

test.describe('KPost Security · KDiary cross-tenant object authorization @api @kpost-api @security @kdiary', () => {
  test.skip(process.env.KDIARY_LIFECYCLE !== 'true', 'creates a real diary event; set KDIARY_LIFECYCLE=true');
  test.skip(!A || !C, 'needs the personal and personal-3 principals');

  test('an unrelated principal can read and silently touch another user\'s diary event @api @security', async ({
    endpoints,
  }) => {
    const ownTitle = `QA Bench KDiary IDOR owner — ${Date.now()}`;
    const created = await endpoints.sendTo(
      'kdiary-create-event',
      { body: scheduleShape({ title: ownTitle }) },
      { label: 'kdiary-idor:create', auth: { principal: A }, allowLiveWrite: true },
    );
    const createdJson = created.json();
    const createdBody = (createdJson.ok ? createdJson.value : {}) as Record<string, unknown>;
    const eventID = extractId(createdBody);
    test.skip(!eventID, 'createEvent did not return a usable eventID; cannot continue');

    try {
      // --- Read attack: C requests A's real eventID via getEventDate ---
      const readAttack = await endpoints.sendTo(
        'kdiary-get-event-date',
        { body: { eventIds: [eventID] } },
        { label: 'kdiary-idor:read-attack', auth: { principal: C }, allowLiveRead: true },
      );
      expect(readAttack.status, 'the read request completes').toBeLessThan(500);
      const readJson = readAttack.json();
      const readBody = (readJson.ok ? readJson.value : {}) as Record<string, unknown>;
      const rows = Array.isArray(readBody.data) ? (readBody.data as Array<Record<string, unknown>>) : [];
      const leakedViaRead = rows.some((r) => r.title === ownTitle);

      if (leakedViaRead) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kdiary-get-event-date',
          ruleId: 'IDOR-kdiary-get-event-date-cross-tenant-read',
          rule: 'A caller must not be able to read another user\'s diary event by naming its eventID.',
          expected: 'the request is refused, or returns no data for an eventID the caller does not own',
          actual: `status=${readAttack.status}, disclosed owner's real title "${ownTitle}" for eventID ${eventID}`,
          request: { body: { eventIds: [eventID] } },
        });
      }
      expect
        .soft(
          leakedViaRead,
          `BOLA: C must not read A's diary event (eventID ${eventID}) via getEventDate ` +
            `(replied ${readAttack.status}, rows=${JSON.stringify(rows)})`,
        )
        .toBe(false);

      // --- Touch attack: C calls updateEvent against A's eventID ---
      const beforeTouch = await endpoints.sendTo(
        'kdiary-get-event-date',
        { body: { eventIds: [eventID] } },
        { label: 'kdiary-idor:touch-baseline', auth: { principal: A }, allowLiveRead: true },
      );
      const beforeJson = beforeTouch.json();
      const beforeBody = (beforeJson.ok ? beforeJson.value : {}) as Record<string, unknown>;
      const beforeRows = Array.isArray(beforeBody.data)
        ? (beforeBody.data as Array<Record<string, unknown>>)
        : [];
      const modifiedBefore = beforeRows.find((r) => r.eventID === eventID)?.modifiedDate ?? null;

      const writeAttack = await endpoints.sendTo(
        'kdiary-update-event',
        { body: scheduleShape({ eventID, repeat: true, daily: true }) },
        { label: 'kdiary-idor:write-attack', auth: { principal: C }, allowLiveWrite: true },
      );
      expect(writeAttack.status, 'the write request completes').toBeLessThan(500);
      const writeJson = writeAttack.json();
      const writeBody = (writeJson.ok ? writeJson.value : {}) as Record<string, unknown>;
      const writeData = (writeBody.data ?? {}) as Record<string, unknown>;
      const leakedViaWrite = writeData.title === ownTitle;

      if (leakedViaWrite) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kdiary-update-event',
          ruleId: 'IDOR-kdiary-update-event-cross-tenant-disclosure',
          rule: 'An unrelated caller\'s updateEvent call must not echo back another user\'s real event content.',
          expected: 'the request is refused, or returns no content belonging to the real owner',
          actual: `status=${writeAttack.status}, updateEvent's own response disclosed owner's real title "${ownTitle}" for eventID ${eventID}`,
          request: { body: scheduleShape({ eventID, repeat: true, daily: true }) },
        });
      }
      expect
        .soft(
          leakedViaWrite,
          `BOLA: C must not have A's diary event content echoed back via updateEvent ` +
            `(replied ${writeAttack.status}, body=${JSON.stringify(writeBody)})`,
        )
        .toBe(false);

      const afterTouch = await endpoints.sendTo(
        'kdiary-get-event-date',
        { body: { eventIds: [eventID] } },
        { label: 'kdiary-idor:touch-verify', auth: { principal: A }, allowLiveRead: true },
      );
      const afterJson = afterTouch.json();
      const afterBody = (afterJson.ok ? afterJson.value : {}) as Record<string, unknown>;
      const afterRows = Array.isArray(afterBody.data) ? (afterBody.data as Array<Record<string, unknown>>) : [];
      const modifiedAfter = afterRows.find((r) => r.eventID === eventID)?.modifiedDate ?? null;
      const touched = modifiedAfter !== null && modifiedAfter !== modifiedBefore;

      if (touched) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kdiary-update-event',
          ruleId: 'IDOR-kdiary-update-event-cross-tenant-touch',
          rule: 'An unrelated caller must not be able to change another user\'s diary event\'s modifiedDate audit field.',
          expected: 'the request is refused, and the event\'s modifiedDate stays unchanged',
          actual: `A's event ${eventID} modifiedDate changed from ${modifiedBefore} to ${modifiedAfter} after a write by an unrelated principal`,
          request: { body: scheduleShape({ eventID, repeat: true, daily: true }) },
        });
      }
      expect
        .soft(
          touched,
          `BOLA: C must not be able to touch A's diary event's modifiedDate (eventID ${eventID}) via updateEvent ` +
            `(was ${modifiedBefore}, now ${modifiedAfter})`,
        )
        .toBe(false);
    } finally {
      await endpoints
        .sendTo(
          'kdiary-delete-event',
          { body: { eventID } },
          { label: 'kdiary-idor:cleanup', auth: { principal: A }, allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
  });
});
