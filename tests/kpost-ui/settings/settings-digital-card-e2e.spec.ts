import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';
import { settleFrames } from '../support/settle';

/** Flips a switch's checkbox as the switch does: the input sits off-screen under its slider. */
async function flip(checkbox: Locator): Promise<void> {
  await checkbox.evaluate((el) => (el as HTMLInputElement).click());
}

/**
 * The switch of one Digital Card row ("About", "Experience", ...): the innermost element holding the
 * label and a checkbox. The checkbox sits under a styled switch, so it is attached, not "visible".
 */
function toggleFor(page: Page, label: RegExp): Locator {
  return page
    .locator('div')
    .filter({ has: page.getByText(label) })
    .filter({ has: page.getByRole('checkbox') })
    .last()
    .getByRole('checkbox')
    .first();
}

/**
 * Settings › Digital Card Settings: flip one privacy toggle, confirm the request and new state, flip it
 * back; plus the rollback when the update fails (stubbed).
 */
test.describe(
  'KPost Settings · Digital Card Settings panel',
  { tag: ['@ui', '@settings', '@regression'] },
  () => {
    test.skip(
      process.env.SETTINGS_UI_LIFECYCLE !== 'true',
      'toggles a real privacy setting; set SETTINGS_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('toggling "About" visibility fires the real update request, then restores the original state @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openTopLevelPanel('Digital Card Settings');

      const aboutCheckbox = toggleFor(page, /^About$/i);
      await expect(aboutCheckbox, 'the About toggle renders').toBeAttached({ timeout: 15_000 });

      const before = await aboutCheckbox.isChecked();

      const requestPromise = page.waitForRequest(
        (req) =>
          req.url().includes('/profile/updatePrivacySettingDetails') && req.method() === 'POST',
        { timeout: 10_000 },
      );
      await flip(aboutCheckbox);
      const request = await requestPromise;

      expect(request, 'toggling About fires a real updatePrivacySettingDetails POST').toBeTruthy();
      await expect(aboutCheckbox, 'the checkbox reflects the new state').toHaveJSProperty(
        'checked',
        !before,
      );

      // Restore.
      const restorePromise = page.waitForRequest(
        (req) =>
          req.url().includes('/profile/updatePrivacySettingDetails') && req.method() === 'POST',
        { timeout: 10_000 },
      );
      await flip(aboutCheckbox);
      await restorePromise;
      await expect(
        aboutCheckbox,
        'the About toggle is restored to its original state',
      ).toHaveJSProperty('checked', before);
    });

    test('a failed update request rolls the toggle back to its previous state @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openTopLevelPanel('Digital Card Settings');

      const experienceCheckbox = toggleFor(page, /^Experience$/i);
      await expect(experienceCheckbox, 'the Experience toggle renders').toBeAttached({
        timeout: 15_000,
      });
      const before = await experienceCheckbox.isChecked();

      // Stub the update endpoint to fail; the component should roll the toggle back.
      await page.route('**/profile/updatePrivacySettingDetails', (route) =>
        route.fulfill({ status: 500, contentType: 'application/json', body: '{"status":"ERROR"}' }),
      );

      await flip(experienceCheckbox);
      await settleFrames(page);

      await expect(
        experienceCheckbox,
        'a failed update must roll the toggle back to its ORIGINAL state, not leave it showing the ' +
          'unsaved flipped value — the source comments claim this rollback exists; this proves it live',
      ).toHaveJSProperty('checked', before);

      await page.unroute('**/profile/updatePrivacySettingDetails');
    });
  },
);
