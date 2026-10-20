import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { initiateShape } from '@api/definitions/kpost/kall/direct.api';
import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';
import { expect, test } from '@fixtures';

/**
 * Kall **read business rules** — the 6 endpoints `feature.spec.ts`'s status-transition flow never
 * touches: `kallDashboard`, `todayKoolKall`, `frequentKallContacts`, `kallInfo`, `contactInfo`,
 * `fetchScheduledRepeatKall`. All `productionSafe: true`; the two chain tests place/schedule a real
 * call, so they run only with `KALL_LIFECYCLE=true` (same gate as `feature.spec.ts`), self-cleaning.
 *
 * ## Confirmed defect: `contactInfo` never resolves real data
 *
 * Live-verified 2026-09-24: `POST /v2/kall/contactInfo/` returns an envelope of all-null/empty
 * fields (`{"kpostID":null,"contactID":null,"firstName":null,...}`, HTTP 200 "SUCCESS") for every
 * input tried — a real, restored (non-deleted), actively-in-call-history contact
 * (`testData.victimKpostId`), the caller's OWN account, `kallID: null`, and a real `kallID` from a
 * call placed seconds earlier. `kallDashboard` and `kallInfo`, queried for the exact same call in
 * the exact same test, correctly return full details (`senderName`, `kallStartTime`, etc.) — so the
 * data exists and other reads see it; `contactInfo` alone never does, regardless of input. Filed via
 * `recordBusinessRuleViolation` (a 2xx-but-empty-data defect the engine's own validators cannot see)
 * as **#599** [KP-FC6594], HIGH, KPost API.
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;
const contactId = testData.victimKpostId;

/** The kallID from a create response — `data` is an object for direct calls, an array for schedules. */
function extractKallId(bodyText: string): number | undefined {
  const parsed = JSON.parse(bodyText || '{}') as { data?: unknown };
  const data = parsed.data;
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  const obj =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  for (const candidate of [obj?.kallID, row?.kallID]) {
    if (typeof candidate === 'number') return candidate;
  }
  return undefined;
}

test.describe(
  'KPost Kall · read business rules @api @kpost-api @kall',
  { tag: ['@api', '@kall', '@regression'] },
  () => {
    test('frequentKallContacts returns well-formed, non-duplicated contacts', async ({
      endpoints,
    }) => {
      const ex = await endpoints.sendTo(
        'kall-frequent-contacts',
        {},
        { label: 'kall-reads:frequent-contacts', auth: { principal: A } },
      );
      expect(ex.status, 'frequentKallContacts succeeds').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as {
        data?: Array<{ contactID?: string; contactName?: string }>;
      };
      const rows = body.data ?? [];
      expect(rows.length, 'the account has at least one frequent call contact').toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.contactID, 'every frequent contact carries an id').toBeTruthy();
      }
      const ids = rows.map((r) => r.contactID);
      expect(ids, 'no duplicate contacts in the frequent list').toHaveLength(new Set(ids).size);
    });

    test('placing a real call surfaces consistently in kallDashboard and kallInfo — but never in contactInfo', async ({
      endpoints,
    }) => {
      test.skip(
        process.env.KALL_LIFECYCLE !== 'true',
        'places a real call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5)',
      );

      // A contact must be genuinely present (not soft-deleted) for this to test contactInfo fairly.
      await endpoints
        .sendTo(
          'contacts-add',
          {
            body: {
              contactID: contactId,
              firstName: 'Qa',
              lastName: 'Tester',
              userType: 'PERSONAL',
            },
          },
          { label: 'kall-reads:restore-contact', auth: { principal: A }, allowLiveWrite: true },
        )
        .catch(() => undefined);

      try {
        const placed = await endpoints.sendTo(
          'kall-initiate',
          { body: initiateShape({ receiver: contactId }) },
          { label: 'kall-reads:initiate', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(placed.status, 'placing a call succeeds').toBeLessThan(300);
        const kallID = extractKallId(placed.bodyText);
        expect(kallID, 'the placed call issues a kallID').toBeTruthy();

        const dashboard = await endpoints.sendTo(
          'kall-dashboard',
          { body: { kallID: '' } },
          { label: 'kall-reads:dashboard', auth: { principal: A } },
        );
        const dashRows =
          (JSON.parse(dashboard.bodyText || '{}') as { kall?: Array<{ kallID?: number }> }).kall ??
          [];
        expect(
          dashRows.some((r) => r.kallID === kallID),
          'the placed call appears on the kallDashboard',
        ).toBe(true);

        const info = await endpoints.sendTo(
          'kall-info',
          { body: { contactID: contactId, kallID: null } },
          { label: 'kall-reads:info', auth: { principal: A } },
        );
        const infoRows =
          (JSON.parse(info.bodyText || '{}') as { data?: Array<{ kallID?: number }> }).data ?? [];
        expect(
          infoRows.some((r) => r.kallID === kallID),
          'the same call appears in kallInfo for that contact',
        ).toBe(true);

        const contactInfo = await endpoints.sendTo(
          'kall-contact-info',
          { body: { contactID: contactId, kallID } },
          { label: 'kall-reads:contact-info', auth: { principal: A } },
        );
        const civ = JSON.parse(contactInfo.bodyText || '{}') as {
          data?: { kpostID?: unknown; contactID?: unknown; firstName?: unknown };
        };
        const allNull =
          civ.data?.kpostID == null && civ.data?.contactID == null && civ.data?.firstName == null;
        if (allNull) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kall-contact-info',
            ruleId: 'REGRESSION-kall-contactinfo-never-resolves',
            rule:
              'contactInfo must resolve real details (kpostID, firstName, mobileNumber, …) for a ' +
              'valid contact the caller has just placed a call with — the same contact kallDashboard ' +
              'and kallInfo, queried in this same test, resolve correctly.',
            expected: `kpostID "${contactId}" and real profile fields (matching contacts-my-contacts)`,
            actual: `all-null envelope: ${contactInfo.bodyText.slice(0, 200)}`,
            request: { body: { contactID: contactId, kallID } },
          });
        }
        expect
          .soft(
            allNull,
            'contactInfo returned an all-null envelope instead of the real contact it was just used with',
          )
          .toBe(false);
      } finally {
        await endpoints
          .sendTo(
            'kall-clear-history',
            {},
            { label: 'kall-reads:cleanup', auth: { principal: A }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    });

    test('scheduling a call for today surfaces in todayKoolKall', async ({ endpoints }) => {
      test.skip(
        process.env.KALL_LIFECYCLE !== 'true',
        'schedules a real call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5)',
      );
      let kallID: number | undefined;
      try {
        const scheduled = await endpoints.sendTo(
          'kall-scheduled',
          { body: scheduleShape() },
          { label: 'kall-reads:schedule', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(scheduled.status, 'scheduling a call succeeds').toBeLessThan(300);
        kallID = extractKallId(scheduled.bodyText);
        expect(kallID, 'the scheduled call issues a kallID').toBeTruthy();

        const today = await endpoints.sendTo(
          'kall-today-kool',
          {},
          { label: 'kall-reads:today-kool', auth: { principal: A } },
        );
        expect(today.status, 'todayKoolKall succeeds').toBe(200);
        const todayRows =
          (JSON.parse(today.bodyText || '{}') as { data?: Array<{ kallID?: number }> }).data ?? [];
        expect(
          todayRows.some((r) => r.kallID === kallID),
          'a call scheduled for later today appears in todayKoolKall',
        ).toBe(true);
      } finally {
        if (kallID) {
          await endpoints
            .sendTo(
              'kall-end-kool',
              { body: { kallID } },
              { label: 'kall-reads:end-schedule', auth: { principal: A }, allowLiveWrite: true },
            )
            .catch(() => undefined);
        }
      }
    });

    test('kallInfo reports no data for a contact with no call history, without leaking anything', async ({
      endpoints,
    }) => {
      // The caller's own kpostID can never be a call contact of itself — a stable "no history" target.
      const ex = await endpoints.sendTo(
        'kall-info',
        { body: { contactID: testData.kpostId, kallID: null } },
        { label: 'kall-reads:info-empty', auth: { principal: A } },
      );
      expect(ex.status, 'kallInfo does not crash for a contact with no history').toBeLessThan(500);
      const body = JSON.parse(ex.bodyText || '{}') as { data?: unknown[] };
      expect(
        Array.isArray(body.data) ? body.data.length : 0,
        'no call rows are returned for a contact with no history',
      ).toBe(0);
    });

    test('scheduling a repeating call surfaces in fetchScheduledRepeatKall', async ({
      endpoints,
    }) => {
      test.skip(
        process.env.KALL_LIFECYCLE !== 'true',
        'schedules a real repeating call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5)',
      );
      /*
       * A ONE-DAY series: it ends on the day it starts (the meeting's own day — scheduleShape starts it
       * an hour out). A series that ends later is copied every night by RepeatKallMaterializerJob until
       * its end date, and nothing the test can call stops that: clearKallHistory only marks the parent
       * deleted, which the job ignores. Those copies leave both accounts "On Another Call" (#1679) —
       * 18 of them did, after a 6-day series here (2026-10-11..13).
       */
      const startDate = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
      const endDate = startDate;
      // scheduledRepeatKall answers only "Repeat Kool Kall Created" — no kallID (KallControllerV3) —
      // so the series is found by the unique kallSession it was created with. #1681: the list reads the
      // old TBL_KPOST_REPEAT_KOOL_KALL table, so a series created today is not found (fails 2/2).
      const body = scheduleShape({
        repeatType: 1,
        repeatedDate: JSON.stringify({ start_date: startDate, end_date: endDate }),
        kallDetails: [{ receiver: contactId }],
      });
      try {
        const repeat = await endpoints.sendTo(
          'kall-scheduled-repeat',
          { body },
          { label: 'kall-reads:schedule-repeat', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(repeat.status, 'scheduledRepeatKall is accepted').toBeLessThan(300);
        const kallID = extractKallId(repeat.bodyText);

        const fetched = await endpoints.sendTo(
          'kall-fetch-scheduled-repeat',
          { body: { scheduledStartTime: startDate } },
          { label: 'kall-reads:fetch-repeat', auth: { principal: A } },
        );
        expect(fetched.status, 'fetchScheduledRepeatKall succeeds').toBe(200);
        const fetchedRows =
          (
            JSON.parse(fetched.bodyText || '{}') as {
              data?: Array<{ kallID?: number; kallSession?: string }>;
            }
          ).data ?? [];
        test.info().annotations.push({
          type: 'observed',
          description: `create → ${repeat.bodyText.slice(0, 200)}; fetch(${startDate}) → ${fetchedRows.length} row(s): ${JSON.stringify(fetchedRows.slice(0, 2)).slice(0, 600)}`,
        });
        expect(
          fetchedRows.some(
            (r) =>
              r.kallSession === body.kallSession || (kallID !== undefined && r.kallID === kallID),
          ),
          'the repeating call just created appears in fetchScheduledRepeatKall from its start date (#1681)',
        ).toBe(true);
      } finally {
        await endpoints
          .sendTo(
            'kall-clear-history',
            {},
            { label: 'kall-reads:cleanup-repeat', auth: { principal: A }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    });
  },
);
