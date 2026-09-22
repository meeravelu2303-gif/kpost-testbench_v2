import { testData } from '@config/test-data.config';
import { openSection, sweepScreen } from '@ui/breakage-sweep';
import { expect, test } from '@fixtures';

/**
 * Profile & Settings **screen-breakage** sweep — the front-end analogue of "does this screen crash".
 *
 * The deep Profile and Settings screens (editor drawers, tabbed sections, settings sub-panels) are
 * where a user spends real time and where a broken bundle, a 404 asset, an unhandled exception or a
 * frozen render actually bites — and none of it is visible to an API test. This opens each SUB-SECTION
 * captured from a live codegen pass and checks the health of every one.
 *
 * The shared `sweepScreen` helper checks health right after load first (most crashes fire on load),
 * so when the screen already crashed it captures short, readable proof and finishes — rather than
 * walking every panel and recording a minute of an unchanging screen. Read-only: it only navigates
 * and opens panels/tabs, never toggling a preference or clicking Save.
 */

test.describe('KPost Profile & Settings · screen-breakage sweep @ui', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the Profile screen and all its sections load without a crash or broken asset @ui', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await sweepScreen(page, {
      screen: 'Profile',
      route: '/userprofile',
      mount: async () => {
        await expect(
          page.locator('#About, .profilecreation').first(),
          'Profile mounted',
        ).toBeVisible({ timeout: 20_000 });
      },
      walk: async () => {
        for (const tab of ['Experience', 'Education', 'Other Activities'])
          await openSection(page, tab);
        await page
          .locator('.profilecreation')
          .first()
          .click({ timeout: 10_000 })
          .catch(() => undefined);
        for (const section of [
          'About',
          'Basic Information',
          'Contact Information',
          'Education',
          'Experience',
          'Other Activities',
        ]) {
          await openSection(page, section);
        }
      },
    });
  });

  test('the Settings screen and all its panels load without a crash or broken asset @ui', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await sweepScreen(page, {
      screen: 'Settings',
      route: '/settings',
      mount: async () => {
        await expect(
          page.getByText(/General Settings|Profile Creation|Settings/i).first(),
          'Settings mounted',
        ).toBeVisible({ timeout: 20_000 });
      },
      walk: async () => {
        for (const panel of [
          'Notification',
          'Security & Privacy',
          'Blocked Contacts',
          'Account Recovery',
          'Change Password',
          'Change Mobile Number',
          'Personalize',
          'Font Settings',
          'Change Theme',
          'Data Storage',
          'KNews Settings',
          'Mail Signature',
          'Instant Reply',
          'Digital Card',
        ]) {
          await openSection(page, panel);
        }
      },
    });
  });
});
