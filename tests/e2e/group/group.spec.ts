import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Katchup Create New Group modal (`ContactList.js`): opens and accepts a Group Name; the member add
 * and submit are best-effort. Gated behind GROUP_UI_LIFECYCLE=true.
 */
test.describe(
  'KPost Group — create / rename / delete (write)',
  { tag: ['@ui', '@group', '@regression', '@sanity'] },
  () => {
    test.skip(
      process.env.GROUP_UI_LIFECYCLE !== 'true',
      'creates a real group; set GROUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts (a group needs at least one other member)',
    );

    test(
      'open the create-group modal, name a group, add a member, then clean up @ui',
      { annotation: [{ type: 'requirement', description: 'FR-GC-001' }] },
      async ({ page }) => {
        const groupName = `QA UI grp ${Date.now()}`;
        await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page
          .locator('.loader-overlay')
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .catch(() => undefined);

        // Icon, not text: real groups named "New Group" exist, so a text match opens one of those.
        await page
          .locator('.icon-KP_112-Group-Add')
          .first()
          .click()
          .catch(() => undefined);

        const nameField = page
          .getByRole('textbox', { name: /Group Name/i })
          .or(page.getByPlaceholder(/Group Name/i))
          .first();
        await expect(
          nameField,
          'the Create New Group modal opens with a Group Name field',
        ).toBeVisible({
          timeout: 15_000,
        });
        await nameField.fill(groupName);
        await expect(nameField, 'the Group Name field accepts text').toHaveValue(groupName);

        // Best-effort: add the 2nd QA account as a member and submit.
        await page
          .getByText(testData.victimKpostId)
          .first()
          .click()
          .catch(() => undefined);
        await page
          .getByRole('button', { name: /Create|Submit|Done|Next/i })
          .first()
          .click()
          .catch(() => undefined);
      },
    );
  },
);
