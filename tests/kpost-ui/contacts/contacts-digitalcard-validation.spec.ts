import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openDigitalCard } from '../support/contacts';
import { toast } from '../support/validation';

/**
 * A contact's Digital Card › QR code › Share QR refuses a share with no recipient picked
 * (DigitalCard.js sendQRToKatchup / sendQRToKmail). The Katchup and KMail sends are blocked at the
 * network and counted, so nothing is shared.
 */
const SENDS = /\/katchup\/sendMessage|\/sentMail\/postMail/;

for (const [channel, icon] of [
  ['Katchup', 'span.icon-KP_04-Katchup'],
  ['KMail', 'span.icon-KP_03-KMail'],
] as const) {
  test.describe(
    `KPost Contacts · Digital Card QR share to ${channel} needs a recipient`,
    { tag: ['@ui', '@contacts', '@regression'] },
    () => {
      test.skip(!testData.victimKpostId, 'needs the 2nd QA account (QA_VICTIM_KPOST_ID)');

      test(`Share QR to ${channel} with nobody picked is refused`, async ({ page }) => {
        let sent = 0;
        await page.route(
          (url) => SENDS.test(url.pathname),
          (route) => {
            sent += 1;
            return route.abort();
          },
        );
        const card = await openDigitalCard(page, 'qatest2');
        await card.locator('button.dc-qr-trigger').first().click();
        await page
          .locator('button.dc-qr-mini-btn')
          .filter({ hasText: /Share QR/i })
          .first()
          .click();
        await page.locator(icon).last().click({ timeout: 10_000 });
        // The "Forward To" picker opens with nobody chosen; its send button is always enabled.
        await expect(
          page
            .getByRole('dialog')
            .filter({ hasText: /Forward To/i })
            .last(),
          'the recipient picker opens',
        ).toBeVisible({ timeout: 10_000 });
        await page.locator('button.post_button_size').last().click();
        await expect(
          toast(page, 'Please select at least one recipient'),
          'the user is told to pick a recipient',
        ).toBeVisible({ timeout: 10_000 });
        expect(sent, 'nothing was shared').toBe(0);
      });
    },
  );
}
