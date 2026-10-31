import { AUTH_PROFILES } from '@config/auth-profile';
import { scheduleShape } from '@api/definitions/kpost/kdiary/write.api';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { toast } from '../support/validation';

/**
 * KDiary › a task's remarks › "+ Add Participants" › Done with nobody picked is refused
 * (components/Diary/Diary.js handleParticipantSelection). The task is made for today through the
 * API (the browser's own session), the participant update is blocked at the network, and the task is
 * deleted afterwards.
 */
const ME = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal');

/** Local "YYYY-MM-DDTHH:mm:00", `hoursAhead` from now (the diary works in local time). */
function localAt(hoursAhead: number): string {
  const d = new Date(Date.now() + hoursAhead * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

test.describe(
  'KPost KDiary · adding participants to a task needs at least one',
  { tag: ['@ui', '@kdiary', '@regression'] },
  () => {
    test.skip(!ME || !testData.kpostId, 'needs a real QA account (QA_KPOST_ID)');

    test('Done with no participant picked is refused', async ({ page, endpoints }) => {
      const hour = new Date().getHours();
      test.skip(
        hour >= 22,
        'no time left today to make a task for today right now (needs two hours before midnight)',
      );
      const title = `QA participants ${Date.now()}`;
      const as = { auth: { principal: ME! }, allowLiveWrite: true };
      const created = await endpoints.sendTo(
        'kdiary-create-event',
        {
          body: scheduleShape({
            title,
            scheduleStartDateAndTime: localAt(1),
            scheduleEndDateAndTime: localAt(1.5),
          }),
        },
        { label: 'kdiary-participants:create', ...as },
      );
      expect(created.status, 'the task is created for today (setup)').toBeLessThan(300);
      const eventID = (JSON.parse(created.bodyText ?? '{}') as { data?: { eventID?: number } }).data
        ?.eventID;
      try {
        let updates = 0;
        await page.route('**/dairySchedule/addparticipants**', (route) => {
          updates += 1;
          return route.abort();
        });
        await page.goto('/kdiary', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page
          .getByRole('button', { name: `Update remarks for ${title}` })
          .first()
          .click({ timeout: 30_000 });
        await page
          .getByRole('button', { name: /\+?\s*Add Participants/i })
          .first()
          .click();
        await page.locator('button.Done-button').last().click({ timeout: 10_000 });
        await expect(
          toast(page, 'Please select at least one participant.'),
          'the user is told to pick a participant',
        ).toBeVisible({ timeout: 10_000 });
        expect(updates, 'no empty participant list reached the server').toBe(0);
      } finally {
        if (eventID) {
          await endpoints.sendTo(
            'kdiary-delete-event',
            { body: { eventID } },
            { label: 'kdiary-participants:delete', ...as },
          );
        }
      }
    });
  },
);
