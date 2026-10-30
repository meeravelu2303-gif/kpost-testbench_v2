import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { sendsWithin } from '../support/validation';

/**
 * Settings › KMail Settings › Instant Reply refuses an empty reply (InstantReply.js): Add stays
 * disabled with no text, and spaces alone cannot be typed in. The save is blocked at the network, so
 * a reply the screen wrongly lets through is never stored.
 */

const SAVE = '/kmailSetting/saveOrUpdateCustomizedInstantReply';

test.describe(
  'KPost Settings · Instant Reply refuses an empty reply',
  { tag: ['@ui', '@settings', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );

    test('Add stays disabled with no text, and spaces alone do not count as text', async ({
      page,
      settingsPage,
    }) => {
      await page.route(`**${SAVE}**`, (route) => route.abort());
      await settingsPage.goto();
      await settingsPage.openPanel('KMail Settings', 'Instant Reply');
      await page.getByRole('button', { name: /^Add$/ }).first().click();
      const dialog = page.locator('.modal-dialog', { hasText: 'Instant Reply Message' }).last();
      await expect(dialog, 'the Instant Reply form opens').toBeVisible({ timeout: 15_000 });
      const text = dialog.getByPlaceholder('Enter your Instant Reply Message').first();
      const add = dialog.getByRole('button', { name: /^Add$/ }).first();
      await expect(add, 'an empty reply cannot be added').toBeDisabled();
      await text.fill('   ');
      await expect(add, 'a reply of spaces cannot be added').toBeDisabled();
      expect(await sendsWithin(page, SAVE, 2_000), 'nothing was sent').toBe(false);
    });
  },
);
