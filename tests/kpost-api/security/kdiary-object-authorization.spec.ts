// KDiary cross-tenant IDOR. Gated on KDIARY_LIFECYCLE: creates and deletes a real event for A.
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { scheduleShape } from '@api/definitions/kpost/kdiary/write.api';
import { expect, test } from '@fixtures';

/**
 * `getEventDate` and `updateEvent` look an event up by body `eventID(s)` with no ownership check:
 * the read discloses the event, and the update discloses it and touches `modifiedDate`.
 * A owns the event; C is an unrelated principal who must never see or touch it.
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

test.describe(
  'KPost Security · KDiary cross-tenant object authorization @api @kpost-api @security @kdiary',
  {
    tag: ['@api', '@auth', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      process.env.KDIARY_LIFECYCLE !== 'true',
      'creates a real diary event; set KDIARY_LIFECYCLE=true',
    );
    test.skip(!A || !C, 'needs the personal and personal-3 principals');

    test("an unrelated principal can read and silently touch another user's diary event @api @security", async ({
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
        const rows = Array.isArray(readBody.data)
          ? (readBody.data as Array<Record<string, unknown>>)
          : [];
        const leakedViaRead = rows.some((r) => r.title === ownTitle);

        if (leakedViaRead) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kdiary-get-event-date',
            ruleId: 'IDOR-kdiary-get-event-date-cross-tenant-read',
            rule: "A caller must not be able to read another user's diary event by naming its eventID.",
            expected:
              'the request is refused, or returns no data for an eventID the caller does not own',
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
            rule: "An unrelated caller's updateEvent call must not echo back another user's real event content.",
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
        const afterRows = Array.isArray(afterBody.data)
          ? (afterBody.data as Array<Record<string, unknown>>)
          : [];
        const modifiedAfter = afterRows.find((r) => r.eventID === eventID)?.modifiedDate ?? null;
        const touched = modifiedAfter !== null && modifiedAfter !== modifiedBefore;

        if (touched) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kdiary-update-event',
            ruleId: 'IDOR-kdiary-update-event-cross-tenant-touch',
            rule: "An unrelated caller must not be able to change another user's diary event's modifiedDate audit field.",
            expected: "the request is refused, and the event's modifiedDate stays unchanged",
            actual: `A's event ${eventID} modifiedDate changed from ${JSON.stringify(modifiedBefore)} to ${JSON.stringify(modifiedAfter)} after a write by an unrelated principal`,
            request: { body: scheduleShape({ eventID, repeat: true, daily: true }) },
          });
        }
        expect
          .soft(
            touched,
            `BOLA: C must not be able to touch A's diary event's modifiedDate (eventID ${eventID}) via updateEvent ` +
              `(was ${JSON.stringify(modifiedBefore)}, now ${JSON.stringify(modifiedAfter)})`,
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
  },
);
