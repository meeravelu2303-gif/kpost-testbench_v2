import type { Locator, Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openProfileSection } from '../support/profile';

/**
 * Settings › Profile Creation: every text field stops at what the server can store, and a value
 * exactly at that limit is still saved. The limits are the server's own (`src/api/contract/source/
 * kpost-api.limits.json`: the width of the column each field is saved into). Over that, the save
 * fails with a 500 and the screen says nothing (ContactInformation.js only logs the error), so the
 * screen itself must stop the value. Every save is aborted at the network: nothing is written.
 */

/** Aborts saves to `path` and records each attempted body. */
async function captureSaves(page: Page, path: string): Promise<Record<string, unknown>[]> {
  const bodies: Record<string, unknown>[] = [];
  await page.route(`**${path}**`, (route) => {
    bodies.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
    return route.abort();
  });
  return bodies;
}

/** Types like a user (key by key), so the browser's own maxlength applies as it would for them. */
async function typeInto(field: Locator, text: string): Promise<string> {
  await field.fill('');
  await field.pressSequentially(text, { delay: 0 });
  return field.inputValue();
}

const text = (n: number) => 'Q'.repeat(n);
const asText = (v: unknown): string => (typeof v === 'string' ? v : '');
const digits = (n: number) => '9'.repeat(n);

/** Contact Information text fields, the request key each feeds, and its column width. */
const CONTACT_TEXT = [
  { placeholder: 'Enter City', key: 'city', max: 25, column: 'city varchar(25)' },
  { placeholder: 'Enter Area', key: 'areaName', max: 50, column: 'area_name varchar(50)' },
  {
    placeholder: 'Enter Landline Number',
    key: 'landLineNumber',
    max: 45,
    column: 'landline_number varchar(45)',
  },
  {
    placeholder: 'Enter Address line 1',
    key: 'addressLine1',
    max: 250,
    column: 'present_address varchar(250)',
  },
] as const;

test.describe(
  'KPost Profile · fields stop at what the server stores @ui',
  { tag: ['@ui', '@profile', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default', timeout: 180_000 });
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );

    test('About: typing stops at 500 characters, and 500 are saved', async ({ page }) => {
      const saves = await captureSaves(page, '/profile/updateAboutYourself');
      const panel = await openProfileSection(page, 'About');
      const about = panel.getByPlaceholder('Write about yourself...').first();
      await expect(about, 'the About editor renders').toBeVisible({ timeout: 20_000 });
      expect(await typeInto(about, text(501)), 'a 501st character is not taken').toHaveLength(500);
      await panel
        .getByRole('button', { name: /^Update$/ })
        .first()
        .click();
      await expect.poll(() => saves.length, { message: 'the save is sent' }).toBeGreaterThan(0);
      expect(String(saves[0]?.aboutYourself), 'all 500 characters are sent').toHaveLength(500);
    });

    test('Contact Information: Pin Code takes 6 digits and Second Mobile 10', async ({ page }) => {
      const panel = await openProfileSection(page, 'Contact Information');
      const pin = panel.getByPlaceholder('Enter Pincode').first();
      await expect(pin, 'the Contact Information form renders').toBeVisible({ timeout: 20_000 });
      expect(await typeInto(pin, '6000011'), 'a 7th pincode digit is not taken').toBe('600001');
      expect(await typeInto(pin, '60a0b0'), 'letters are dropped from the pincode').toBe('6000');
      // Second Mobile is enabled only while Address line 2 has text (ContactInformation.js
      // `isDisabled={value.addresslinetwo ? false : true}`); a local value, never saved.
      const line2 = panel.getByPlaceholder('Enter Address line 2').first();
      const original = await line2.inputValue();
      if (!original) await line2.fill('QA line 2');
      const mobile = panel.getByPlaceholder('Enter Second Mobile Number').first();
      expect(await typeInto(mobile, digits(11)), 'an 11th mobile digit is not taken').toHaveLength(
        10,
      );
      await line2.fill(original);
    });

    test('Contact Information: no text field takes more than its column holds', async ({
      page,
    }) => {
      const saves = await captureSaves(page, '/profile/updateContactInformation');
      const panel = await openProfileSection(page, 'Contact Information');
      await expect(panel.getByPlaceholder('Enter City').first()).toBeVisible({ timeout: 20_000 });
      test.skip(
        !(await panel
          .getByPlaceholder('Enter Address line 1')
          .first()
          .inputValue()
          .catch(() => '')),
        'no saved address on this account yet, so the required fields cannot be kept as they are',
      );
      for (const field of CONTACT_TEXT) {
        const input = panel.getByPlaceholder(field.placeholder).first();
        const original = await input.inputValue();
        const typed = await typeInto(input, text(field.max + 1));
        const before = saves.length;
        await panel
          .getByRole('button', { name: /^Update$/ })
          .first()
          .click();
        await page.waitForTimeout(1_500);
        const sent = saves.slice(before).map((b) => asText(b[field.key]));
        // Either the field stops the extra character, or the screen refuses to send it.
        const overflowed = typed.length > field.max && sent.some((v) => v.length > field.max);
        expect
          .soft(
            overflowed,
            `${field.placeholder}: ${field.max + 1} characters reach the server, which stores ${field.max} (${field.column}) and fails with a 500 the screen does not report`,
          )
          .toBe(false);
        await input.fill(original);
      }
    });

    test('Contact Information: each text field at exactly its limit is still saved', async ({
      page,
    }) => {
      const saves = await captureSaves(page, '/profile/updateContactInformation');
      const panel = await openProfileSection(page, 'Contact Information');
      await expect(panel.getByPlaceholder('Enter City').first()).toBeVisible({ timeout: 20_000 });
      test.skip(
        !(await panel
          .getByPlaceholder('Enter Address line 1')
          .first()
          .inputValue()
          .catch(() => '')),
        'no saved address on this account yet, so the required fields cannot be kept as they are',
      );
      // Address line 2 shares the address column: empty, so line 1 alone is at the limit.
      await panel.getByPlaceholder('Enter Address line 2').first().fill('');
      for (const field of CONTACT_TEXT) {
        const input = panel.getByPlaceholder(field.placeholder).first();
        const original = await input.inputValue();
        expect
          .soft(await typeInto(input, text(field.max)), `${field.placeholder}: ${field.max} typed`)
          .toHaveLength(field.max);
        const before = saves.length;
        await panel
          .getByRole('button', { name: /^Update$/ })
          .first()
          .click();
        await expect
          .poll(() => saves.length, { message: `${field.placeholder}: the save is sent` })
          .toBeGreaterThan(before);
        expect
          .soft(asText(saves.at(-1)?.[field.key]), `${field.placeholder}: sent in full`)
          .toHaveLength(field.max);
        await input.fill(original);
      }
    });
  },
);
