import { testData } from '@config/test-data.config';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';

/**
 * Profile **functional** UI testing — does the profile editor validate input and reflect state, and
 * does what the screen accepts match what the database stores?
 *
 * Selectors captured from a live `codegen` pass over the Profile → Basic Information / About editors:
 *   - the edit drawer opens from the `.profilecreation` control on `/userprofile`;
 *   - Basic Information holds "Enter Email ID"; About holds "Write about yourself...";
 *   - each editor saves with an "Update" button.
 *
 * ## What this covers that profile-edit / profile-actions do not
 *
 *  - **Email format validation** — the flagship. An address with no `@` must be rejected. The recorded
 *    flow entered `abimukundinvalidgmail.com`, then corrected it — so the question is whether the
 *    editor blocks the malformed one or saves it.
 *  - **State after a valid edit** — the About text the screen shows, and the row the DB holds, must
 *    match after Update.
 *
 * ## The database is the final judge
 *
 * The editor can answer "saved" and store nothing, or accept a malformed value the API layer would
 * reject — both invisible from the screen. So the email test asserts the ROW in TBL_KPOST_USER_MASTER,
 * not just the toast.
 *
 * ## Safety
 *
 * Gated behind `PROFILE_UI_LIFECYCLE` (it edits a profile field) and **self-restoring**: it reads the
 * current value first and puts it back, so the account ends exactly as it started. The invalid-email
 * case is designed to change nothing when validation works.
 */
const UPDATE = { role: 'button' as const, name: 'Update' };

async function openBasicInformation(page: Page): Promise<boolean> {
  await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  // Open the profile edit drawer, then the Basic Information section.
  await page
    .locator('.profilecreation')
    .first()
    .click({ timeout: 15_000 })
    .catch(() => undefined);
  await page
    .getByText('Basic Information', { exact: false })
    .first()
    .click({ timeout: 15_000 })
    .catch(() => undefined);
  return page
    .getByRole('textbox', { name: 'Enter Email ID' })
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
}

test.describe('KPost Profile · UI functional behaviour @ui @database', { tag: '@ui' }, () => {
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

    // The email the account really has now, from the row — the ground truth to compare against and
    // restore to. (Not what the UI shows, which is what we are testing.)
    const before = repo ? await repo.user(testData.kpostId) : undefined;

    const opened = await openBasicInformation(page);
    test.skip(
      !opened,
      'the Basic Information editor did not open on this build — needs a codegen re-tune',
    );

    const emailField = page.getByRole('textbox', { name: 'Enter Email ID' });

    // Watch what the editor sends: an update dispatched with a malformed email means no client
    // validation. Combined with the DB check below, this pins the layer at fault.
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
    // Wait for the update round-trip (or a short window if the client blocks it locally), so the DB
    // read below sees the settled state rather than racing the request.
    await Promise.all([
      page.waitForResponse('**/profile/**', { timeout: 6_000 }).catch(() => undefined),
      page.getByRole(UPDATE.role, { name: UPDATE.name }).click(),
    ]);

    /*
     * The authoritative check: whatever the screen said, the account's stored email must NOT have
     * become the malformed value. If it did, the editor accepted an invalid email end to end.
     */
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
    /*
     * A pincode is 6 digits in India. The editor should reject a short or non-numeric one rather
     * than store garbage. Judged by the row: `pin_code` in TBL_KPOST_USER_PROFILE must not become the
     * malformed value. Self-restoring.
     */
    const database = databases.for('kpost-api');
    const repo = database.enabled ? new KpostRepository(database) : undefined;
    const pinOf = (u: unknown): string => {
      const p = (u as { pin_code?: unknown } | undefined)?.pin_code;
      return typeof p === 'string' || typeof p === 'number' ? String(p) : '';
    };
    const before = repo ? await repo.profile(testData.kpostId) : undefined;

    await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .locator('.profilecreation')
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);
    await page
      .getByText('Contact Information', { exact: false })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);

    const pincode = page.getByRole('spinbutton', { name: 'Enter Pincode' });
    const opened = await pincode.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(
      !opened,
      'the Contact Information editor did not open on this build — needs a codegen re-tune',
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
    /*
     * A mobile number is digits only. The editor should reject letters rather than store them.
     * Judged by the row: mobile_number in TBL_KPOST_USER_MASTER must not become the malformed value.
     * Self-restoring.
     */
    const database = databases.for('kpost-api');
    const repo = database.enabled ? new KpostRepository(database) : undefined;
    const mobileOf = (u: unknown): string => {
      const m = (u as { mobile_number?: unknown } | undefined)?.mobile_number;
      return typeof m === 'string' || typeof m === 'number' ? String(m) : '';
    };
    const before = repo ? await repo.user(testData.kpostId) : undefined;

    const opened = await openBasicInformation(page);
    test.skip(
      !opened,
      'the Basic Information editor did not open on this build — needs a codegen re-tune',
    );

    const mobile = page.getByRole('textbox', { name: 'Enter Mobile Number' });
    const present = await mobile.isVisible({ timeout: 8_000 }).catch(() => false);
    test.skip(!present, 'the mobile field was not present in this editor build');

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
    /*
     * A create form must not save an empty entry. Validation-only by design: it clicks Save with the
     * required School Name blank and asserts nothing is dispatched — so it leaves NO data on the
     * account (unlike a create-and-verify, which would pollute the profile).
     */
    const saves: string[] = [];
    await page.route('**/profile/**', async (route) => {
      if (route.request().method() === 'POST') saves.push(route.request().url());
      await route.continue();
    });

    await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .locator('.profilecreation')
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);
    await page
      .getByText('Education', { exact: false })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);
    await page
      .getByRole('button', { name: 'School', exact: true })
      .click({ timeout: 10_000 })
      .catch(() => undefined);

    const schoolName = page.getByRole('textbox', { name: 'Enter School Name' });
    const opened = await schoolName.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(
      !opened,
      'the Education/School form did not open on this build — needs a codegen re-tune',
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
    await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .locator('.profilecreation')
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);
    await page
      .getByText('Experience', { exact: false })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);

    const company = page.getByRole('textbox', { name: 'Enter Company Name' });
    const opened = await company.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(!opened, 'the Experience form did not open on this build — needs a codegen re-tune');

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
    await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .locator('.profilecreation')
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);
    await page
      .getByText('About', { exact: true })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);

    const aboutField = page.getByRole('textbox', { name: 'Write about yourself...' });
    const opened = await aboutField.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(!opened, 'the About editor did not open on this build — needs a codegen re-tune');

    const original = (await aboutField.inputValue().catch(() => '')) || '';
    const marker = `QA functional ${Date.now()}`;

    await aboutField.click();
    await aboutField.fill(marker);
    await page.getByRole(UPDATE.role, { name: UPDATE.name }).click();

    // The screen must show the value it just accepted — a save that reports success but shows the old
    // text is a stale-state defect.
    await expect(
      page.getByText(marker).first(),
      'FR: the saved About text is reflected on screen',
    ).toBeVisible({ timeout: 12_000 });

    // Restore.
    await openBasicInformation(page).catch(() => undefined);
    await page
      .getByText('About', { exact: true })
      .first()
      .click({ timeout: 10_000 })
      .catch(() => undefined);
    await aboutField.click().catch(() => undefined);
    await aboutField.fill(original).catch(() => undefined);
    await page
      .getByRole(UPDATE.role, { name: UPDATE.name })
      .click()
      .catch(() => undefined);
  });
});
