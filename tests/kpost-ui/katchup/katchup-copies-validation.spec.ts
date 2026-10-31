import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { EDITOR, openComposerFor } from '../support/katchup';
import { toast } from '../support/validation';

/**
 * Katchup › Copies (bubble MultipleContact.js): a message can go to at most 60 copies and 20
 * confidential copies. The account has far fewer contacts, so the contact list is answered with 61
 * made-up contacts (they exist only in this browser) besides the 2nd QA account, and sending is
 * blocked at the network.
 */
const FAKE = 61;

async function seedManyContacts(page: Page): Promise<void> {
  const contact = (i: number) => ({
    id: 990000 + i,
    kpostID: testData.kpostId,
    contactID: `qa.copies.${i}@kpostindia.com`,
    firstName: 'QA Copies',
    lastName: String(i).padStart(2, '0'),
    referenceName: '',
    userType: 'PERSONAL',
    isBlocked: false,
    deleteStatus: false,
    countryID: 1,
    countryCode: '91',
    activeStatus: 'yes',
  });
  await page.route('**/contacts/myContacts/**', async (route) => {
    const real = await route.fetch();
    const body = (await real.json()) as { contacts_added?: unknown[] };
    body.contacts_added = [
      ...(body.contacts_added ?? []),
      ...Array.from({ length: FAKE }, (_, i) => contact(i + 1)),
    ];
    await route.fulfill({ response: real, json: body });
  });
}

/** Opens the Copies window for a typed message to the 2nd QA account. */
async function openCopies(page: Page) {
  await page.route('**/katchup/sendMessage/**', (route) => route.abort());
  await seedManyContacts(page);
  await openComposerFor(page, testData.victimKpostId);
  await page.locator(EDITOR).first().click();
  await page.keyboard.type('QA bench: copies limit check.');
  await page.locator('div.icon-KP_229_Copies1').first().click();
  const modal = page
    .getByRole('dialog')
    .filter({ hasText: /Message With Copies/i })
    .last();
  await expect(modal, 'the copies window opens').toBeVisible({ timeout: 10_000 });
  return modal;
}

test.describe(
  'KPost Katchup · Copies are limited to 60 copies and 20 confidential copies',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(!testData.victimKpostId, 'needs the 2nd QA account (QA_VICTIM_KPOST_ID)');

    for (const [kind, column, limit, rule] of [
      ['copies', 0, 60, 'A maximum of 60 members can be selected for copies !'],
      [
        'confidential copies',
        1,
        20,
        'A maximum of 20 members can be selected for Confidential Copy !',
      ],
    ] as const) {
      test(`more than ${limit} ${kind} are refused`, async ({ page }) => {
        const modal = await openCopies(page);
        // Each contact row has a radio per kind: Copy first, Confidential Copy second.
        const radios = modal.locator('input[type="radio"]');
        await expect
          .poll(() => radios.count(), {
            message: 'the made-up contacts are listed',
            timeout: 15_000,
          })
          .toBeGreaterThan(2 * limit);
        for (let i = 0; i < limit; i += 1) {
          await radios.nth(2 * i + column).check({ force: true });
        }
        // The next one is refused: the radio stays unticked and the limit is shown.
        const extra = radios.nth(2 * limit + column);
        await extra.click({ force: true });
        await expect(toast(page, rule), `the ${limit + 1}th is refused`).toBeVisible({
          timeout: 10_000,
        });
        await expect(extra, 'and is not selected').not.toBeChecked();
      });
    }
  },
);
