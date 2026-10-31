import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { createQaGroup, deleteQaGroup, GROUP_CREATOR, type QaGroup } from '../support/groups';
import { EDITOR, openComposerFor, openGroupConversation } from '../support/katchup';
import { toast } from '../support/validation';

/**
 * Katchup compose rules (bubble WriteMessage.js): a secret "To Delete as per Schedule" message needs
 * a time other than 00:00:00, and a group message needs another active member to go to. Nothing is
 * sent: sendMessage is stopped at the network and counted.
 */
const PERSONAL = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal');

test.describe(
  'KPost Katchup · compose refuses a message it cannot deliver',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(!testData.victimKpostId, 'needs the 2nd QA account (QA_VICTIM_KPOST_ID)');

    test('a scheduled secret message with the time left at 00:00:00 is refused', async ({
      page,
    }) => {
      let sends = 0;
      await page.route('**/katchup/sendMessage/**', (route) => {
        sends += 1;
        return route.abort();
      });
      await openComposerFor(page, testData.victimKpostId);
      await page.locator('div.icon-KP_227_Secret-Message').first().click({ timeout: 15_000 });
      const modal = page
        .getByRole('dialog')
        .filter({ hasText: /Confidential Message/i })
        .last();
      await expect(modal, 'the secret-message options open').toBeVisible({ timeout: 10_000 });
      await modal.locator('input[name="deletionOption"][value="DeleteAsPerSchedule"]').check();
      await expect(modal.getByText(/00:00:00/).first(), 'the timer starts at zero').toBeVisible();
      await modal.locator('button.Schedule-button').click();
      await expect(
        toast(page, 'Time cannot be set to 00:00:00'),
        'the user is told to pick a time',
      ).toBeVisible({ timeout: 10_000 });
      expect(sends, 'nothing was sent').toBe(0);
    });

    test('a group message with no other active member is refused', async ({ page, endpoints }) => {
      test.skip(!GROUP_CREATOR || !PERSONAL, 'needs provisioned qatest3 and the browser account');
      let sends = 0;
      await page.route('**/katchup/sendMessage/**', (route) => {
        sends += 1;
        return route.abort();
      });
      // As the browser's account (in a browser project the API reuses the browser's session).
      const asBrowserUser = (id: string, body: Record<string, unknown>, label: string) =>
        endpoints.sendTo(
          id,
          { body },
          {
            label: `compose-validation:${label}`,
            auth: { principal: PERSONAL! },
            allowLiveWrite: true,
          },
        );
      let group: QaGroup | undefined;
      let creatorRemoved = false;
      try {
        // qatest3 makes a group with the browser's account as a second admin. Admins cannot leave
        // ("Admins cannot exit the group. Remove the members instead"), so the browser's account
        // removes qatest3 and is left as the only active member.
        group = await createQaGroup(endpoints, 'solo member', { admins: [testData.kpostId] });
        const removed = await asBrowserUser(
          'group-remove-member',
          {
            memberKpostIdList: [GROUP_CREATOR!.username],
            groupID: group.groupID,
            groupKpostID: group.groupKpostID,
          },
          'remove-creator',
        );
        creatorRemoved = removed.status < 300;
        expect(
          removed.status,
          'qatest3 is removed, so the browser account is alone (setup)',
        ).toBeLessThan(300);

        expect(
          await openGroupConversation(page, group.groupKpostID),
          'the group is listed (setup)',
        ).toBe(true);
        await page.locator('.msg-arrow').first().click({ timeout: 15_000 });
        await page.getByRole('textbox', { name: 'Subject' }).fill(`QA solo ${Date.now()}`);
        await page.locator(EDITOR).first().click();
        await page.keyboard.type('QA bench: nobody else is in this group.');
        // The rule sits on the Send button's click (WriteMessage.js), not on Enter.
        await page.getByRole('button', { name: 'Send message' }).first().click();
        await expect(
          toast(page, /There no active Member to select/),
          'the user is told there is nobody to send to',
        ).toBeVisible({ timeout: 10_000 });
        expect(sends, 'nothing was sent').toBe(0);
      } finally {
        if (group && creatorRemoved) {
          // The browser's account is the last member and an admin, so it deletes the group.
          await asBrowserUser(
            'group-delete',
            { groupID: group.groupID, groupKpostID: group.groupKpostID },
            'delete-group',
          ).catch(() => undefined);
        } else {
          await deleteQaGroup(endpoints, group);
        }
      }
    });
  },
);
