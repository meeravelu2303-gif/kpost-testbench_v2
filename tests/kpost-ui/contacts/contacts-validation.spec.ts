import type { Locator, Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openConversation } from '../support/katchup';
import { toast } from '../support/validation';

/**
 * Contacts › a contact's Add Ref (conversation header) › Add Reference refuses an empty reference
 * (bubble/AddReference: Save is disabled while the field is empty, a blank one is refused with
 * "Reference name must not be empty.") and sends a real one as typed. addContactReference is
 * blocked at the network, so the contact (qatest2, kept in qatest1's book by the Contacts
 * flows; qatest4 is deleted and re-added by contacts-actions-e2e) never changes.
 */

const ADD_REFERENCE = '**/contacts/addContactReference**';

/** Blocks addContactReference; returns the bodies the screen tried to send. */
async function blockReferenceSave(page: Page): Promise<Array<Record<string, unknown>>> {
  const sent: Array<Record<string, unknown>> = [];
  await page.route(ADD_REFERENCE, (route) => {
    sent.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
    return route.abort();
  });
  return sent;
}

/** The conversation header's Add Ref opens the same AddReference editor as the Digital Card. */
async function openReferenceEditor(page: Page): Promise<{ field: Locator; save: Locator }> {
  await openConversation(page, testData.victimKpostId);
  await page.getByText('Add Ref', { exact: true }).first().click();
  const editor = page
    .locator('.modal-dialog')
    .filter({ has: page.getByPlaceholder('Add Reference') })
    .last();
  await expect(editor, 'the Add Reference editor opens').toBeVisible({ timeout: 15_000 });
  const field = editor.getByPlaceholder('Add Reference');
  await field.fill('');
  return { field, save: editor.getByRole('button', { name: /^Save$/ }) };
}

test.describe(
  'KPost Contacts · Add Reference refuses an empty reference',
  { tag: ['@ui', '@contacts', '@regression'] },
  () => {
    test.skip(
      !testData.victimKpostId,
      'needs the 2nd QA account (QA_VICTIM_KPOST_ID) in the address book',
    );

    test('Save stays disabled while the reference is empty', async ({ page }) => {
      const sent = await blockReferenceSave(page);
      const { save } = await openReferenceEditor(page);
      await expect(save, 'an empty reference cannot be saved').toBeDisabled();
      expect(sent, 'nothing was sent').toHaveLength(0);
    });

    test('a reference of only spaces is refused and never sent', async ({ page }) => {
      const sent = await blockReferenceSave(page);
      const { field, save } = await openReferenceEditor(page);
      await field.fill('   ');
      await save.click();
      await expect(
        toast(page, 'Reference name must not be empty.'),
        'the user is told the reference is empty',
      ).toBeVisible({ timeout: 10_000 });
      expect(sent, 'a blank reference never reaches the server').toHaveLength(0);
    });

    test('a real reference is sent as typed', async ({ page }) => {
      const sent = await blockReferenceSave(page);
      const { field, save } = await openReferenceEditor(page);
      const reference = `QA Ref ${Date.now()}`;
      await field.fill(reference);
      await expect(save, 'a typed reference can be saved').toBeEnabled();
      await save.click();
      await expect
        .poll(() => sent.length, { message: 'the reference is sent', timeout: 10_000 })
        .toBe(1);
      expect(sent[0]?.referenceName, 'it is sent exactly as typed').toBe(reference);
      expect(sent[0]?.contactID, 'for the right contact').toBe(testData.victimKpostId);
    });
  },
);
