import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';
import { STORAGE_STATE_2, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { gotoKoolKall } from '../support/kall';
import { C, openSession, requireAccounts, requireFlags } from './support/journey';

/**
 * Journey 4: C schedules a Kool Kall via the API inviting A and B; each sees it under Kall › Kool
 * Kall; C ends it. C is the organizer because an API call as A or B would sign their browser out.
 */

/** The kallID in a scheduledKall reply. */
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

    test(
      'an organizer schedules a Kool Kall and both invitees see it in Kall',
      { tag: '@sanity' },
      async ({ page, browser, endpoints }) => {
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
                  kallDetails: [
                    { receiver: testData.kpostId },
                    { receiver: testData.victimKpostId },
                  ],
                }),
              },
              { label: 'journey:meeting:schedule', auth: { principal: C! }, allowLiveWrite: true },
            );
            expect(scheduled.status, 'the meeting is scheduled').toBeLessThan(300);
            const json = scheduled.json();
            kallID = kallIdOf((json.ok ? json.value : {}) as Record<string, unknown>);
            expect(kallID, 'the meeting has an id').toBeTruthy();
          });

          await test.step('A sees the meeting on Kool Kall', async () => {
            await gotoKoolKall(page);
            await expect(
              page.getByText(title).first(),
              'A sees the meeting they were invited to',
            ).toBeVisible({
              timeout: 30_000,
            });
          });

          await test.step('B sees the same meeting in their own browser', async () => {
            await gotoKoolKall(b.page);
            await expect(b.page.getByText(title).first(), 'B sees the meeting too').toBeVisible({
              timeout: 30_000,
            });
          });
        } finally {
          // `kallID` alone: sending `id` too makes endKoolKall answer 500.
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
      },
    );
  },
);
