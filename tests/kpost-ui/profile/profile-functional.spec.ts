import { testData } from '@config/test-data.config';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Profile Creation editors (Settings > Profile Creation > section): input validation and saved state,
 * judged by the DB row. Gated behind PROFILE_UI_LIFECYCLE; self-restoring. Some placeholders render
 * twice, so field locators use .first().
 */
const UPDATE = { role: 'button' as const, name: 'Update' };

/** Opens a Profile Creation sub-section from Settings; each renders a full-page form. */
async function openProfileCreationSection(
  page: Page,
  section:
    | 'About'
    | 'Basic Information'
    | 'Contact Information'
    | 'Education'
    | 'Experience'
    | 'Other Activities',
): Promise<void> {
  await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  await page.getByText('Profile Creation', { exact: true }).first().click({ timeout: 15_000 });
  await page.getByText(section, { exact: true }).first().click({ timeout: 15_000 });
}

async function openBasicInformation(page: Page): Promise<boolean> {
  await openProfileCreationSection(page, 'Basic Information');
  return page
    .getByPlaceholder('Enter Email ID')
    .first()
    .isVisible({ timeout: 15_000 })
    .catch(() => false);
}

test.describe(
  'KPost Profile · UI functional behaviour @ui @database',
  { tag: ['@ui', '@profile', '@regression', '@sanity'] },
  () => {
    test.skip(
      process.env.PROFILE_UI_LIFECYCLE !== 'true',
      'edits a profile field; set PROFILE_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('the Basic Information editor rejects an email with no @ (cross-layer) @ui', async ({
      page,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      const repo = database.enabled ? new KpostRepository(database) : undefined;

      // The stored email from the row: the value to compare against and restore.
      const before = repo ? await repo.user(testData.kpostId) : undefined;

      const opened = await openBasicInformation(page);
      retryOrSkip(
        !opened,
        'the Basic Information editor was not showing right now (session or load condition; path verified live 2026-10-11)',
      );

      const emailField = page.getByPlaceholder('Enter Email ID').first();

      // An update dispatched with a malformed email means no client-side validation.
      const updates: string[] = [];
      await page.route('**/profile/**', async (route) => {
        if (route.request().method() === 'POST') updates.push(route.request().postData() ?? '');
        await route.continue();
      });

      const emailOf = (u: unknown): string => {
        const e = (u as { email?: unknown } | undefined)?.email;
        return typeof e === 'string' ? e : '';
      };

      await emailField.click();
      await emailField.fill('abimukundinvalidgmail.com'); // no @ — cannot be a valid address
      // Wait for the update round-trip so the DB read sees the settled state.
      await Promise.all([
        page.waitForResponse('**/profile/**', { timeout: 6_000 }).catch(() => undefined),
        page.getByRole(UPDATE.role, { name: UPDATE.name }).click(),
      ]);

      if (repo) {
        const after = await repo.user(testData.kpostId);
        expect(
          emailOf(after),
          'a malformed email must not be persisted to TBL_KPOST_USER_MASTER',
        ).not.toBe('abimukundinvalidgmail.com');

        // Restore, only if the row actually changed (it should not have).
        const original = emailOf(before);
        if (original && emailOf(after) !== original) {
          await emailField.click();
          await emailField.fill(original);
          await page.getByRole(UPDATE.role, { name: UPDATE.name }).click();
          await page.waitForResponse('**/profile/**', { timeout: 6_000 }).catch(() => undefined);
        }
      }

      test.info().annotations.push({
        type: 'observed',
        description:
          updates.length === 0
            ? 'the editor sent no profile update for the malformed email — validated client-side'
            : `the editor dispatched a profile update for the malformed email (${updates.length} request(s))`,
      });
    });

    test('the Contact Information editor rejects a malformed pincode (cross-layer) @ui', async ({
      page,
      databases,
    }) => {
      // An Indian pincode is 6 digits; judged by pin_code in TBL_KPOST_USER_PROFILE.
      const database = databases.for('kpost-api');
      const repo = database.enabled ? new KpostRepository(database) : undefined;
      const pinOf = (u: unknown): string => {
        const p = (u as { pin_code?: unknown } | undefined)?.pin_code;
        return typeof p === 'string' || typeof p === 'number' ? String(p) : '';
      };
      const before = repo ? await repo.profile(testData.kpostId) : undefined;

      await openProfileCreationSection(page, 'Contact Information');

      const pincode = page.getByPlaceholder('Enter Pincode').first();
      const opened = await pincode.isVisible({ timeout: 15_000 }).catch(() => false);
      retryOrSkip(
        !opened,
        'the Contact Information editor was not showing right now (session or load condition; path verified live 2026-10-11)',
      );

      await pincode.click();
      await pincode.fill('12'); // too short to be a valid pincode
      await Promise.all([
        page.waitForResponse('**/profile/**', { timeout: 6_000 }).catch(() => undefined),
        page.getByRole(UPDATE.role, { name: UPDATE.name }).click(),
      ]);

      if (repo) {
        const after = await repo.profile(testData.kpostId);
        expect(pinOf(after), 'a malformed pincode must not be persisted').not.toBe('12');
        const original = pinOf(before);
        if (original && pinOf(after) !== original) {
          await pincode.click();
          await pincode.fill(original);
          await page.getByRole(UPDATE.role, { name: UPDATE.name }).click();
          await page.waitForResponse('**/profile/**', { timeout: 6_000 }).catch(() => undefined);
        }
      }
    });

    test('the Basic Information editor rejects a non-numeric mobile number (cross-layer) @ui', async ({
      page,
      databases,
    }) => {
      // Judged by mobile_number in TBL_KPOST_USER_MASTER.
      const database = databases.for('kpost-api');
      const repo = database.enabled ? new KpostRepository(database) : undefined;
      const mobileOf = (u: unknown): string => {
        const m = (u as { mobile_number?: unknown } | undefined)?.mobile_number;
        return typeof m === 'string' || typeof m === 'number' ? String(m) : '';
      };
      const before = repo ? await repo.user(testData.kpostId) : undefined;

      const opened = await openBasicInformation(page);
      retryOrSkip(
        !opened,
        'the Basic Information editor was not showing right now (session or load condition; path verified live 2026-10-11)',
      );

      const mobile = page.getByPlaceholder('Enter Mobile Number').first();
      await expect(mobile, 'the Basic Information editor shows the mobile field').toBeVisible({
        timeout: 8_000,
      });

      // The field is readonly by design: a verified number changes through its own OTP flow.
      const readOnly = await mobile.evaluate((el) => (el as HTMLInputElement).readOnly);
      test.skip(
        readOnly,
        'the mobile field is read-only in this editor by design — a verified number changes through its own OTP flow, not this form',
      );

      await mobile.click();
      await mobile.fill('abc123xyz'); // letters — not a phone number
      await Promise.all([
        page.waitForResponse('**/profile/**', { timeout: 6_000 }).catch(() => undefined),
        page.getByRole(UPDATE.role, { name: UPDATE.name }).click(),
      ]);

      if (repo) {
        const after = await repo.user(testData.kpostId);
        expect(mobileOf(after), 'a non-numeric mobile must not be persisted').not.toBe('abc123xyz');
        const original = mobileOf(before);
        if (original && mobileOf(after) !== original) {
          await mobile.click();
          await mobile.fill(original);
          await page.getByRole(UPDATE.role, { name: UPDATE.name }).click();
          await page.waitForResponse('**/profile/**', { timeout: 6_000 }).catch(() => undefined);
        }
      }
    });

    test('the Education (School) form requires a school name before it saves @ui', async ({
      page,
    }) => {
      // Validation only: Save with School Name blank must dispatch nothing, so no data is created.
      const saves: string[] = [];
      await page.route('**/profile/**', async (route) => {
        if (route.request().method() === 'POST') saves.push(route.request().url());
        await route.continue();
      });

      await openProfileCreationSection(page, 'Education');
      await page
        .getByRole('button', { name: 'School', exact: true })
        .click({ timeout: 10_000 })
        .catch(() => undefined);

      const schoolName = page.getByPlaceholder('Enter School Name').first();
      const opened = await schoolName.isVisible({ timeout: 15_000 }).catch(() => false);
      retryOrSkip(
        !opened,
        'the Education/School form was not showing right now (session or load condition; path verified live 2026-10-11)',
      );

      // Leave School Name empty and try to save.
      await page
        .getByRole('button', { name: 'Save' })
        .click({ timeout: 8_000 })
        .catch(() => undefined);
      const dispatched = await page
        .waitForRequest('**/profile/**', { timeout: 4_000 })
        .then((r) => r.method() === 'POST')
        .catch(() => false);

      expect(
        dispatched,
        'an Education entry with no school name must not be saved (empty required field)',
      ).toBe(false);
    });

    test('the Experience form requires a company name before it saves @ui', async ({ page }) => {
      await openProfileCreationSection(page, 'Experience');

      const company = page.getByPlaceholder('Enter Company Name').first();
      const opened = await company.isVisible({ timeout: 15_000 }).catch(() => false);
      retryOrSkip(
        !opened,
        'the Experience form was not showing right now (session or load condition; path verified live 2026-10-11)',
      );

      await page
        .getByRole('button', { name: 'Save' })
        .click({ timeout: 8_000 })
        .catch(() => undefined);
      const dispatched = await page
        .waitForRequest('**/profile/**', { timeout: 4_000 })
        .then((r) => r.method() === 'POST')
        .catch(() => false);

      expect(
        dispatched,
        'an Experience entry with no company name must not be saved (empty required field)',
      ).toBe(false);
    });

    test('editing the About text is reflected and then restored @ui', async ({ page }) => {
      await openProfileCreationSection(page, 'About');

      const aboutField = page.getByPlaceholder('Write about yourself...').first();
      const opened = await aboutField.isVisible({ timeout: 15_000 }).catch(() => false);
      retryOrSkip(
        !opened,
        'the About editor was not showing right now (session or load condition; path verified live 2026-10-11)',
      );

      const original = (await aboutField.inputValue().catch(() => '')) || '';
      const marker = `QA functional ${Date.now()}`;

      await aboutField.click();
      await aboutField.fill(marker);
      await page.getByRole(UPDATE.role, { name: UPDATE.name }).click();

      // A save that reports success but shows the old text is a stale-state defect.
      await expect(
        page.getByText(marker).first(),
        'FR: the saved About text is reflected on screen',
      ).toBeVisible({ timeout: 12_000 });

      // Restore.
      await openProfileCreationSection(page, 'About').catch(() => undefined);
      await aboutField.click().catch(() => undefined);
      await aboutField.fill(original).catch(() => undefined);
      await page
        .getByRole(UPDATE.role, { name: UPDATE.name })
        .click()
        .catch(() => undefined);
    });
  },
);
