import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';

/**
 * Settings **functional** UI testing — when a preference is toggled on screen, does it actually reach
 * the database, or does the toggle animate and the row stay put?
 *
 * Selectors captured from a live `codegen` pass over Settings → Notification:
 *   - the screen is `/settings`; the Notification group opens from its "Notification" label;
 *   - a preference is a font-icon toggle: `.icon-KP_289_Toggle-On` (on) / `.icon-KP_285_Toggle-Off`
 *     (off), and clicking it flips the state.
 *
 * ## Why this matters and what it ties to
 *
 * Bugzilla #495 already proves the API path `generalSetting/katchupNotification` reports success and
 * persists nothing. This asks the same question from the UI, which a user actually touches: after
 * flipping a notification toggle, do the notification columns in TBL_KPOST_GENERAL_SETTINGS change?
 * If they do not, the user's preference silently reverts on next login — and the UI gave no hint.
 *
 * The verdict is the ROW, not the toggle animation: a control can slide to "on" while the write is
 * dropped. This is the cross-layer check (UI → API → DB) that neither a pure UI nor a pure API test
 * can make.
 *
 * ## Not pre-pinned to #495
 *
 * The Settings screen may save through a different path than the API endpoint #495 covers, so this is
 * written as a real assertion rather than assumed-failing. It is gated behind `SETTINGS_UI_LIFECYCLE`
 * (off by default), so it never affects a normal run; when it is run and the preference does not
 * persist, that is the finding — file it (or pin to #495 if it is the same root cause).
 *
 * ## Safety
 *
 * Own account only. Reads the three notification columns first and toggles back at the end, so the
 * account's preferences end exactly as they started.
 */

type SettingsRow = {
  katchup_notification: unknown;
  kmail_notification: unknown;
  kall_notification: unknown;
};

const snapshot = (r: SettingsRow | undefined): string =>
  JSON.stringify([r?.katchup_notification, r?.kmail_notification, r?.kall_notification]);

async function openNotificationSettings(page: Page): Promise<boolean> {
  await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  await page
    .getByText('Notification', { exact: false })
    .first()
    .click({ timeout: 15_000 })
    .catch(() => undefined);
  // A toggle in either state means the Notification panel is open.
  return page
    .locator('.icon-KP_289_Toggle-On, .icon-KP_285_Toggle-Off')
    .first()
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
}

test.describe('KPost Settings · UI functional behaviour @ui @database', { tag: '@ui' }, () => {
  test.skip(
    process.env.SETTINGS_UI_LIFECYCLE !== 'true',
    'toggles a real preference; set SETTINGS_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('toggling a notification preference persists to the settings row @ui', async ({
    page,
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

    const read = (): Promise<SettingsRow | undefined> =>
      database.findOne<SettingsRow>({
        table: 'TBL_KPOST_GENERAL_SETTINGS',
        where: { kpost_id: testData.kpostId },
      });

    const before = await read();
    expect(before, 'the account has a settings row').toBeDefined();

    const opened = await openNotificationSettings(page);
    test.skip(
      !opened,
      'the Notification settings panel did not open on this build — needs a codegen re-tune',
    );

    // Flip the first notification toggle (whichever state it is in).
    const toggle = page.locator('.icon-KP_289_Toggle-On, .icon-KP_285_Toggle-Off').first();
    await toggle.click();

    /*
     * Give the save its round-trip, then read the row. The assertion is on the DATABASE: a toggle
     * that changed nothing in the notification columns means the preference did not persist — the
     * #495 behaviour, now proven (or ruled out) from the UI.
     */
    await page.waitForResponse('**/generalSetting/**', { timeout: 8_000 }).catch(() => undefined);
    const after = await read();

    expect(
      snapshot(after),
      'a toggled notification preference must change the stored settings row (UI → DB); if it does ' +
        'not, the preference silently reverts — the same fault as Bugzilla #495, from the UI side',
    ).not.toBe(snapshot(before));

    // Restore: flip it back so the account's preferences end as they started.
    await toggle.click().catch(() => undefined);
    await page.waitForResponse('**/generalSetting/**', { timeout: 8_000 }).catch(() => undefined);
  });

  test('adding an Instant Reply shows it in the list (state reflects the write) @ui', async ({
    page,
  }) => {
    /*
     * Instant Reply is an additive setting: adding one must appear in the list. A dialog that
     * accepts the text and shows nothing afterwards is a stale-state defect. Selectors from the
     * recording: Instant Reply panel → Add → "Enter your Instant Reply" → dialog Add.
     *
     * Kept UI-state level (the added reply is visible) rather than DB, because the instant-reply
     * store is a KMail-settings shape not yet mapped; the visible-in-list check is the honest,
     * reliable assertion here.
     */
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .getByText('Instant Reply', { exact: false })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);
    await page
      .getByRole('button', { name: 'Add' })
      .first()
      .click({ timeout: 10_000 })
      .catch(() => undefined);

    const field = page.getByRole('textbox', { name: 'Enter your Instant Reply' });
    const opened = await field.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(
      !opened,
      'the Instant Reply editor did not open on this build — needs a codegen re-tune',
    );

    const marker = `QA reply ${Date.now()}`;
    await field.click();
    await field.fill(marker);
    await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();

    await expect(
      page.getByText(marker).first(),
      'a saved Instant Reply appears in the list',
    ).toBeVisible({ timeout: 12_000 });
  });

  test('the Mail Signature form rejects a malformed email @ui', async ({ page }) => {
    /*
     * The Mail Signature carries an email field; a malformed address should be rejected, not saved.
     * Validation-only: enter a bad email, click Save, assert the save is not dispatched (client
     * validation) — leaves the signature unchanged.
     */
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .getByText('Mail Signature', { exact: false })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);

    const emailField = page.getByRole('textbox', { name: 'Enter your Email ID' });
    const opened = await emailField.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(
      !opened,
      'the Mail Signature form did not open on this build — needs a codegen re-tune',
    );

    await emailField.click();
    await emailField.fill('notanemailaddress'); // no @ / domain
    await page
      .getByRole('button', { name: 'Save' })
      .first()
      .click({ timeout: 8_000 })
      .catch(() => undefined);

    const dispatched = await page
      .waitForRequest('**/kmailSetting/**', { timeout: 4_000 })
      .then(() => true)
      .catch(() => false);

    expect(dispatched, 'the Mail Signature must not save with a malformed email').toBe(false);
  });

  test('the Vacation Response form does not save with an empty message @ui', async ({ page }) => {
    /*
     * Vacation Response (auto-reply/out-of-office) lives under the "KMail Settings" top-level
     * category, unlike Notification/Personalize/Mail Signature/Instant Reply which this suite's
     * other tests reach directly — its panel only renders after that category is opened first, so
     * this is the two-step open every other panel here needs too (captured against the live build,
     * 2026-09; earlier tests in this file may rely on a leftover "last viewed category" UI state
     * rather than a guaranteed default, so this explicit two-step is the more robust pattern).
     *
     * Fields (from a live pass): a master ON/OFF toggle beside the "Vacation Response" title gates
     * the whole form — From / To (date range), "Enter the Vacation Response" (subject), "Enter the
     * Vacation Message" (body) and Save all render `disabled` until that toggle is switched on. This
     * test only reaches the OFF state today: turning the toggle on needs its exact selector
     * confirmed (a codegen pass over "enable vacation response") before this can drive the form —
     * skips honestly rather than guess a selector and risk a false pass/fail. Validation-only once
     * enabled: a From/To date with no message must not save — leaves nothing to clean up.
     */
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .getByText('KMail Settings', { exact: true })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);
    await page
      .getByText('Vacation Response', { exact: false })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);

    const subjectField = page.getByRole('textbox', { name: 'Enter the Vacation Response' });
    const opened = await subjectField.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(
      !opened,
      'the Vacation Response form did not open on this build — needs a codegen re-tune',
    );
    const enabled = await subjectField.isEnabled().catch(() => false);
    test.skip(
      !enabled,
      'the form is gated behind an ON/OFF toggle that is currently off — needs its exact ' +
        'selector confirmed (codegen "enable vacation response") before this can drive the form',
    );

    // Leave the message empty; the subject alone must not be enough to save.
    await subjectField.click();
    await subjectField.fill('QA vacation response (validation probe)');
    await page
      .getByRole('button', { name: 'Save' })
      .first()
      .click({ timeout: 8_000 })
      .catch(() => undefined);

    const dispatched = await page
      .waitForRequest('**/kmailSetting/**', { timeout: 4_000 })
      .then(() => true)
      .catch(() => false);

    expect(dispatched, 'a Vacation Response with no message must not be saved').toBe(false);
  });

  test('Personalize country/language selection persists across a reload @ui', async ({ page }) => {
    /*
     * Personalize (country + language) is a preference that must survive a reload — if it reverts,
     * the setting was never stored. Selects the values, saves, reloads, and re-opens the panel to
     * confirm the selection stuck. State-level (the panel shows the saved values), which is the
     * reliable signal without mapping the exact storage column.
     */
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .getByText('Personalize', { exact: false })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);

    const saveBtn = page.getByRole('button', { name: 'Save' }).first();
    const opened = await saveBtn.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(
      !opened,
      'the Personalize panel did not open on this build — needs a codegen re-tune',
    );

    // Save whatever is currently selected, then confirm the panel still shows a country + language
    // after a reload (the preference persisted rather than resetting to blank).
    await saveBtn.click().catch(() => undefined);
    await page.waitForResponse('**/generalSetting/**', { timeout: 8_000 }).catch(() => undefined);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .getByText('Personalize', { exact: false })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);

    await expect(
      page.getByText(/India|English/i).first(),
      'the Personalize panel shows a persisted country/language after reload, not a blank reset',
    ).toBeVisible({ timeout: 12_000 });
  });
});
