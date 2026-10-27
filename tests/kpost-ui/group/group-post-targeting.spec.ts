import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { createQaGroup, deleteQaGroup, GROUP_CREATOR, type QaGroup } from '../support/groups';
import { EDITOR, openGroupConversation } from '../support/katchup';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Group Post To targeting (FR-GMSG, `WriteMessage.js`): the first Post click in a multi-member group
 * offers All Members / Selected Members, and Selected Members opens the picker. Never sends.
 * The group is created by personal-3 and torn down.
 */
const VIEWER = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal');
const OTHER = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'victim');

test.describe(
  'KPost Katchup · group message targeting (FR-GMSG Post To All / Selected)',
  { tag: ['@ui', '@group', '@regression'] },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      process.env.GROUP_UI_LIFECYCLE !== 'true',
      'creates and deletes a real group; set GROUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !VIEWER ||
        !OTHER ||
        !GROUP_CREATOR ||
        !testData.kpostId ||
        testData.kpostId.includes('qa.bench') ||
        !testData.personal3KpostId ||
        testData.personal3KpostId.includes('qa.p3'),
      'needs the primary, 2nd and personal-3 QA accounts',
    );

    test('Post offers All Members / Selected Members, and Selected Members opens the member picker @ui', async ({
      page,
      endpoints,
    }) => {
      let group: QaGroup | undefined;
      try {
        group = await createQaGroup(endpoints, 'post-targeting', {
          admins: [VIEWER!.username],
          members: [OTHER!.username],
        });
        const opened = await openGroupConversation(page, group.groupKpostID);
        retryOrSkip(!opened, 'the new group was not listed in Katchup right now (four reloads)');

        await page.locator('.msg-arrow').first().click();
        const composer = page.locator('.writeMsg_mainDiv').first();
        await expect(composer, 'the group composer opens').toBeVisible({ timeout: 15_000 });

        await page.getByRole('textbox', { name: 'Subject' }).fill('QA targeting subject');
        await page.locator(EDITOR).first().click();
        await page.keyboard.type('QA targeting body — never posted');

        // First Post click in a multi-member group with nothing selected → the targeting options.
        await composer.locator('.post_button_size').first().click();
        const options = composer.locator('.grp_optPosition, .grp_optExpandPosition').first();
        await expect(options, 'Post opens the targeting options instead of sending').toBeVisible({
          timeout: 10_000,
        });
        await expect(
          options.getByText('All Members', { exact: true }),
          '"All Members" is offered',
        ).toBeVisible();
        await expect(
          options.getByText('Selected Members', { exact: true }),
          '"Selected Members" is offered',
        ).toBeVisible();

        // "Selected Members" → the Select Members picker, listing the other members (not the viewer).
        await options.getByText('Selected Members', { exact: true }).click();
        const picker = page.locator('.modal.show, [role="dialog"]').last();
        await expect(
          picker.getByText(/Select Members/i).first(),
          'the member picker opens',
        ).toBeVisible({
          timeout: 10_000,
        });
        const otherShown = await picker
          .getByText(
            new RegExp(
              (OTHER!.username.split('@')[0] ?? OTHER!.username).replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&',
              ),
              'i',
            ),
          )
          .first()
          .isVisible()
          .catch(() => false);
        test.info().annotations.push({
          type: 'observed',
          description: `picker lists the other member by id/name: ${otherShown}`,
        });

        // Leave without posting: close the picker (its header close, or Escape), then clear the draft.
        const close = picker.locator('.icon-KP_136-Close').first();
        if (await close.isVisible().catch(() => false)) await close.click();
        else await page.keyboard.press('Escape');
        await expect(picker, 'the picker closes').toBeHidden({ timeout: 10_000 });
        await composer
          .locator('.icon-KP_29-Delete[title="Clear"]')
          .first()
          .click()
          .catch(() => undefined);
      } finally {
        await deleteQaGroup(endpoints, group);
      }
    });
  },
);
