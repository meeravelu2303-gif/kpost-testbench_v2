import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';
import { STORAGE_STATE_2, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { gotoKoolKall } from '../support/kall';
import { C, openSession, requireAccounts, requireFlags } from './support/journey';

/**
 * JOURNEY 4 · A MEETING — an organizer schedules a Kool Kall and the people invited see it.
 *
 * C (the organizer, through the API) schedules a meeting an hour from now inviting A and B → A opens
 * Kall › Kool Kall and sees the meeting → B does the same in their own browser → C ends the meeting.
 *
 * Why the organizer is C, through the API: no spec has ever submitted the Create-Kool-Kall modal
 * (its participant picker needs a recording pass — `kall-features.spec.ts`, NEEDS-CODEGEN), and an
 * API call as A or B would sign their browsers out (one session per account). Scheduling as a third
 * account is also the honest model of the journey: the invitees are the users under test.
 *
 * UNPROVEN STEP (first live run): the meeting row on the Kool Kall tab. No spec has asserted a
 * scheduled meeting there yet; the check is the meeting's unique title as visible text.
 * Not covered: joining a connected call (WebRTC, FR-KL-009 — no media harness on this bench).
 */

/** The kallID in a scheduledKall reply (as `tests/api/kpost/kall/feature.spec.ts` reads it). */
function kallIdOf(body: Record<string, unknown>): number | undefined {
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

test.describe(
  'JOURNEY 4 · a meeting',
  {
    tag: [TAGS.ui, TAGS.journey, TAGS.kall, TAGS.regression],
    annotation: [{ type: 'requirement-partial', description: 'FR-KL-002' }],
  },
  () => {
    test.describe.configure({ timeout: 180_000 });
    requireAccounts('A', 'B', 'C');
    requireFlags('KALL_UI_LIFECYCLE', 'KATCHUP_UI_LIFECYCLE');

    test('an organizer schedules a Kool Kall and both invitees see it in Kall', async ({
      page,
      browser,
      endpoints,
    }) => {
      const title = `QA journey meeting ${Date.now()}`;
      let kallID: number | undefined;
      const b = await openSession(browser, STORAGE_STATE_2);

      try {
        await test.step('C schedules the meeting, inviting A and B', async () => {
          const scheduled = await endpoints.sendTo(
            'kall-scheduled',
            {
              body: scheduleShape({
                subject: title,
                kallDetails: [{ receiver: testData.kpostId }, { receiver: testData.victimKpostId }],
              }),
            },
            { label: 'journey:meeting:schedule', auth: { principal: C! }, allowLiveWrite: true },
          );
          expect(scheduled.status, 'the meeting is scheduled').toBeLessThan(300);
          const json = scheduled.json();
          kallID = kallIdOf((json.ok ? json.value : {}) as Record<string, unknown>);
          expect(kallID, 'the meeting has an id').toBeTruthy();
        });

        await test.step('A sees the meeting on Kool Kall (UNPROVEN STEP)', async () => {
          await gotoKoolKall(page);
          await expect(
            page.getByText(title).first(),
            'A sees the meeting they were invited to',
          ).toBeVisible({
            timeout: 30_000,
          });
        });

        await test.step('B sees the same meeting in their own browser (UNPROVEN STEP)', async () => {
          await gotoKoolKall(b.page);
          await expect(b.page.getByText(title).first(), 'B sees the meeting too').toBeVisible({
            timeout: 30_000,
          });
        });
      } finally {
        // `kallID` alone: sending `id` too makes endKoolKall answer 500 (kall feature spec).
        if (kallID)
          await endpoints
            .sendTo(
              'kall-end-kool',
              { body: { kallID } },
              { label: 'journey:meeting:end', auth: { principal: C! }, allowLiveWrite: true },
            )
            .catch(() => undefined);
        await b.context.close();
      }
    });
  },
);
