import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import type { SettingsPage } from '@pages/SettingsPage';
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

async function openNotificationSettings(page: Page, settingsPage: SettingsPage): Promise<boolean> {
  await settingsPage.goto();
  await settingsPage.openPanel('General Settings', 'Notification');
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
    settingsPage,
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

    const opened = await openNotificationSettings(page, settingsPage);
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
    settingsPage,
  }) => {
    /*
     * Instant Reply is an additive setting: adding one must appear in the list. A dialog that
     * accepts the text and shows nothing afterwards is a stale-state defect. Selectors from the
     * recording: Instant Reply panel → Add → "Enter your Instant Reply" → dialog Add.
     *
     * Kept UI-state level (the added reply is visible) rather than DB, because the instant-reply
     * store is a KMail-settings shape not yet mapped; the visible-in-list check is the honest,
     * reliable assertion here.
     *
     * Nested under "KMail Settings", per source (`Settingdetails.js`) — must be expanded first or
     * the item is not in the DOM at all (see SettingsPage.ts's openPanel).
     */
    await settingsPage.goto();
    await settingsPage.openPanel('KMail Settings', 'Instant Reply');
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

  test('completing the Mail Signature chain with a malformed email does not crash the page @ui', async ({
    page,
    settingsPage,
  }) => {
    /*
     * Confirmed from source (`Mailsignature.js`): this panel imports no `Services/*` at all — every
     * "Save" button (five of them, one per sub-section) is wired to `onClick={() => setInputvalue("")}`,
     * which replaces the whole `inputvalue` OBJECT state with a bare STRING. Every control in this
     * component reads `inputvalue.firstname`/`inputvalue.email`/etc., so this is a live crash
     * candidate on the next render — the same bug class already confirmed and exercised for Vacation
     * Response (`settings-vacation-response.spec.ts`).
     *
     * There is no network call to assert against here (asserting "no kmailSetting request fires" would
     * be vacuously true — it never fires for ANY input, valid or not), so the honest, real assertion is
     * whether the confirmed state-corruption bug actually throws on this build. The fields are also
     * progressively disabled (First Name -> Last Name -> Designation -> Email), so the full chain must
     * be filled to even reach the Email field.
     */
    await settingsPage.goto();
    await settingsPage.openPanel('KMail Settings', 'Mail Signature');

    const stop = watchUiHealth(page);

    const firstName = page.getByPlaceholder('Enter your First Name').first();
    await expect(firstName, 'the Mail Signature form renders').toBeVisible({ timeout: 15_000 });
    await firstName.fill('QA');

    const lastName = page.getByPlaceholder('Enter your Last Name').first();
    await expect(lastName, 'Last Name becomes enabled once First Name is set').toBeEnabled({
      timeout: 5_000,
    });
    await lastName.fill('Tester');

    const designation = page.getByPlaceholder('Enter Designation').first();
    await expect(
      designation,
      'Designation becomes enabled once Last Name is set',
    ).toBeEnabled({ timeout: 5_000 });
    await designation.fill('QA Engineer');

    const emailField = page.getByPlaceholder('Enter your Email ID').first();
    await expect(emailField, 'Email becomes enabled once Designation is set').toBeEnabled({
      timeout: 5_000,
    });
    await emailField.fill('notanemailaddress'); // no @ / domain — no client validation exists either

    await page.getByRole('button', { name: /^Save$/i }).first().click({ timeout: 8_000 });
    await page.waitForTimeout(1_500);

    const health = stop();
    test.info().annotations.push({
      type: 'observed',
      description: `page errors after clicking Save: ${JSON.stringify(health.pageErrors)}`,
    });

    expect(
      health.pageErrors,
      'Save is confirmed from source to call setInputvalue("") — replacing an object-shaped state ' +
        'with a string — this asserts whether that actually throws on the live build',
    ).toEqual([]);
  });

  // The Vacation Response empty-message validation test that used to live here was removed
  // 2026-10-02: it asserted "no `kmailSetting` network request fires" as its success condition, but
  // `settings-vacation-response.spec.ts` confirmed from source (`Vacationresponse.js`) that this
  // panel makes NO network call at all, ever, regardless of input — `Services/*` is never imported.
  // That made the old test vacuously true for the wrong reason (it would "pass" even if a real
  // message were filled in correctly), not a genuine validation check. The replacement file instead
  // exercises the panel's three real, source-confirmed bugs (toggle doesn't actually disable fields,
  // broken `textarea` value binding, Save corrupts component state) directly — see that file.

  test('the Change Language Save button is confirmed non-functional — selection does not survive a reload @ui', async ({
    page,
    settingsPage,
  }) => {
    /*
     * Confirmed directly from source (`Personalize.js`'s "Change Language" tab, lines ~338-351): the
     * Save button there carries NO `onClick` at all — only a `disabled`/background-color binding on
     * whether a language is chosen. (Personalize.js DOES call a real backend for its Theme tabs via
     * `Services/ThemeSettings`, so this is a narrow, confirmed gap in ONE control, not a blanket "this
     * component never calls the backend" claim like Mail Signature/Vacation Response.)
     *
     * The honest assertion is the real, user-visible consequence: pick a Country + Language, click
     * Save, reload, and the selection is gone — because nothing was ever wired to persist it.
     */
    await settingsPage.goto();
    await settingsPage.openPanel('General Settings', 'Personalize');

    const countryControl = page.getByText('Select Country', { exact: true }).first();
    await expect(countryControl, 'the Country dropdown renders').toBeVisible({ timeout: 15_000 });
    // react-select renders a sibling input-container that intercepts pointer events on the
    // placeholder text itself; force the click rather than chase the exact DOM depth.
    await countryControl.click({ force: true });
    // Scope option clicks to the open react-select menu — a bare page-wide `getByText('English')`
    // also matches a hidden native <option> elsewhere on the page (e.g. a header language switcher).
    await page.locator('.react-select__menu').getByText('India', { exact: true }).click();

    const languageControl = page.getByText('Select Language', { exact: true }).first();
    await languageControl.click({ force: true });
    await page.locator('.react-select__menu').getByText('English', { exact: true }).click();

    // Confirms the selection itself works client-side (react-select updates its control display).
    await expect(
      page.getByText('India', { exact: true }).first(),
      'the Country control shows the picked value',
    ).toBeVisible({ timeout: 5_000 });

    const saveBtn = page.getByRole('button', { name: /^Save$/i }).first();
    await expect(saveBtn, 'Save becomes enabled once a language is picked').toBeEnabled({
      timeout: 5_000,
    });
    await saveBtn.click();
    await page.waitForTimeout(1_000);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    // A reload remounts the accordion collapsed — the group must be re-expanded before the
    // nested "Personalize" item is in the DOM again.
    await settingsPage.openPanel('General Settings', 'Personalize');

    await expect(
      page.getByText('Select Country', { exact: true }).first(),
      'confirmed: the Country selection reverts to the blank placeholder after reload — Save has no ' +
        'onClick handler in source, so the choice was never persisted anywhere',
    ).toBeVisible({ timeout: 12_000 });
  });
});
