import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings · Digital Card Settings panel (`DigitalCardSettings.js`) — 7 real, optimistic toggles
 * (Mobile Number, About, Education — School/College/University, Experience, Other Activities), each
 * firing `UpdateDigitalCardSettings` -> `POST /v2/profile/updatePrivacySettingDetails` immediately on
 * click, with the source's own comment confirming a rollback-on-failure design ("Rollback on API
 * failure" / "Rollback on network error"). Self-restoring: this test flips ONE toggle, confirms the
 * real request fires and the UI reflects the new state, then flips it back so the account's privacy
 * settings end exactly as they started — same discipline as `settings-functional.spec.ts`'s
 * notification-toggle test for the same "does a toggle animate without persisting" risk class (#495).
 */
test.describe('KPost Settings · Digital Card Settings panel', { tag: '@ui' }, () => {
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

    const aboutRow = page
      .getByText(/^About$/i)
      .first()
      .locator('xpath=../..');
    const aboutCheckbox = aboutRow.getByRole('checkbox');
    await expect(aboutCheckbox, 'the About toggle renders').toBeVisible({ timeout: 15_000 });

    const before = await aboutCheckbox.isChecked();

    const requestPromise = page.waitForRequest(
      (req) =>
        req.url().includes('/profile/updatePrivacySettingDetails') && req.method() === 'POST',
      { timeout: 10_000 },
    );
    await aboutCheckbox.click();
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
    await aboutCheckbox.click();
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

    const experienceRow = page
      .getByText(/^Experience$/i)
      .first()
      .locator('xpath=../..');
    const experienceCheckbox = experienceRow.getByRole('checkbox');
    await expect(experienceCheckbox, 'the Experience toggle renders').toBeVisible({
      timeout: 15_000,
    });
    const before = await experienceCheckbox.isChecked();

    // Stub the update endpoint to fail, per the source's own documented "Rollback on API failure".
    await page.route('**/profile/updatePrivacySettingDetails', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"status":"ERROR"}' }),
    );

    await experienceCheckbox.click();
    await page.waitForTimeout(1_500);

    await expect(
      experienceCheckbox,
      'a failed update must roll the toggle back to its ORIGINAL state, not leave it showing the ' +
        'unsaved flipped value — the source comments claim this rollback exists; this proves it live',
    ).toHaveJSProperty('checked', before);

    await page.unroute('**/profile/updatePrivacySettingDetails');
  });
});
