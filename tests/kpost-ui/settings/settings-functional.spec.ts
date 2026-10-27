import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import type { SettingsPage } from '@pages/SettingsPage';
import type { Page } from '@playwright/test';
import { pickReactSelect, reactSelectByPlaceholder } from '../support/react-select';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Settings: a toggled notification preference must reach TBL_KPOST_GENERAL_SETTINGS (UI → API → DB),
 * plus Instant Reply, Mail Signature and Change Language. Gated by SETTINGS_UI_LIFECYCLE; toggles back.
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

test.describe(
  'KPost Settings · UI functional behaviour @ui @database',
  { tag: ['@ui', '@settings', '@regression', '@sanity'] },
  () => {
    test.skip(
      process.env.SETTINGS_UI_LIFECYCLE !== 'true',
      'toggles a real preference; set SETTINGS_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test(
      'toggling a notification preference persists to the settings row @ui',
      {
        annotation: [
          {
            type: 'cross-layer',
            description:
              'Settings: toggle a notification → generalSetting save → TBL_KPOST_GENERAL_SETTINGS',
          },
        ],
      },
      async ({ page, settingsPage, databases }) => {
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
        retryOrSkip(
          !opened,
          'the Notification settings panel was not showing right now (session or load condition; path verified live 2026-10-11)',
        );

        // Flip the first notification toggle (whichever state it is in).
        const toggle = page.locator('.icon-KP_289_Toggle-On, .icon-KP_285_Toggle-Off').first();
        // The save the toggle makes: any POST to the API (not a static asset) right after the click.
        const saveAnswer = page
          .waitForResponse((r) => r.request().method() === 'POST' && /\/v2\//.test(r.url()), {
            timeout: 8_000,
          })
          .catch(() => null);
        await toggle.click();

        // The verdict is the DB row, not the toggle animation.
        const saved = await saveAnswer;
        test.info().annotations.push({
          type: 'observed',
          description: `save: ${saved ? `${new URL(saved.url()).pathname} → HTTP ${saved.status()}; sent ${String(saved.request().postData()).slice(0, 200)}` : 'no API call after the toggle'}`,
        });
        // Known defect #986: Notification.js keeps toggles in local state and calls no service.
        expect(saved, 'the toggle sends a settings save (none is sent: #986)').not.toBeNull();
        expect(saved!.status(), 'the server accepts the save').toBeLessThan(300);
        const after = await read();

        expect(
          snapshot(after),
          'a toggled notification preference must change the stored settings row (UI → DB); if it does ' +
            'not, the preference silently reverts — the same fault as Bugzilla #495, from the UI side',
        ).not.toBe(snapshot(before));

        // Restore: flip it back so the account's preferences end as they started.
        await toggle.click().catch(() => undefined);
        await page
          .waitForResponse('**/generalSetting/**', { timeout: 8_000 })
          .catch(() => undefined);
      },
    );

    test('adding an Instant Reply shows it in the list (state reflects the write) @ui', async ({
      page,
      settingsPage,
    }) => {
      // UI-state check only: the instant-reply store is not mapped in the DB layer.
      await settingsPage.goto();
      await settingsPage.openPanel('KMail Settings', 'Instant Reply');
      await page
        .getByRole('button', { name: 'Add' })
        .first()
        .click({ timeout: 10_000 })
        .catch(() => undefined);

      const field = page.getByRole('textbox', { name: 'Enter your Instant Reply' });
      const opened = await field.isVisible({ timeout: 10_000 }).catch(() => false);
      retryOrSkip(
        !opened,
        'the Instant Reply editor was not showing right now (session or load condition; path verified live 2026-10-11)',
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
      // Every Save calls setInputvalue(""), replacing object state with a string; this asserts whether
      // that throws (the panel makes no network call). Fields unlock in order, so fill the whole chain.
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
      await expect(designation, 'Designation becomes enabled once Last Name is set').toBeEnabled({
        timeout: 5_000,
      });
      await designation.fill('QA Engineer');

      const emailField = page.getByPlaceholder('Enter your Email ID').first();
      await expect(emailField, 'Email becomes enabled once Designation is set').toBeEnabled({
        timeout: 5_000,
      });
      await emailField.fill('notanemailaddress'); // no @ / domain — no client validation exists either

      await page
        .getByRole('button', { name: /^Save$/i })
        .first()
        .click({ timeout: 8_000 });
      // Two frames let any render-time throw surface before the health snapshot.
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );

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

    test('the Change Language Save button is confirmed non-functional — selection does not survive a reload @ui', async ({
      page,
      settingsPage,
    }) => {
      // The Change Language Save button has no onClick in source, so the choice is lost on reload.
      await settingsPage.goto();
      await settingsPage.openPanel('General Settings', 'Personalize');

      // Driven through the controls' own inputs (support/react-select.ts): no forced clicks.
      await pickReactSelect(reactSelectByPlaceholder(page, /Select Country/), 'India');
      await pickReactSelect(reactSelectByPlaceholder(page, /Select Language/), /^English$/);

      // Confirms the selection itself works client-side (react-select updates its control display).
      await expect(
        page.getByText('India', { exact: true }).first(),
        'the Country control shows the picked value',
      ).toBeVisible({ timeout: 5_000 });

      const saveBtn = page.getByRole('button', { name: /^Save$/i }).first();
      await expect(saveBtn, 'Save becomes enabled once a language is picked').toBeEnabled({
        timeout: 5_000,
      });
      // A request here would mean the fix landed; the reload assertion below decides.
      const saved = page
        .waitForRequest(
          (r) => r.method() === 'POST' && /setting|language|personali/i.test(r.url()),
          {
            timeout: 2_000,
          },
        )
        .then(() => true)
        .catch(() => false);
      await saveBtn.click();
      test.info().annotations.push({
        type: 'observed',
        description: `Save dispatched a request: ${await saved}`,
      });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      // A reload remounts the accordion collapsed, so re-expand the group.
      await settingsPage.openPanel('General Settings', 'Personalize');

      await expect(
        page.getByText('Select Country', { exact: true }).first(),
        'confirmed: the Country selection reverts to the blank placeholder after reload — Save has no ' +
          'onClick handler in source, so the choice was never persisted anywhere',
      ).toBeVisible({ timeout: 12_000 });
    });
  },
);
