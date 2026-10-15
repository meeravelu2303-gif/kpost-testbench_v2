import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { mailShape } from '@api/definitions/kmail/send.api';
import type { Page, Request } from '@playwright/test';

/**
 * KMail settings → does saving them actually change KMail? (Settings › KMail Settings, live
 * 2026-10-15.) The existing settings specs only check these panels render / do not crash.
 *
 * Source (components/Settings): Mail Signature and Vacation Response import NO service at all — every
 * Save is `onClick={() => setInputvalue("")}` — and no Services/*.js function saves a signature or a
 * vacation response (only salutations and instant replies are saved). These tests assert the correct,
 * user-visible behaviour: a saved setting is still there after a reload (and a request was sent).
 * Instant Reply is the positive control: a reply added in Settings must show in KMail's Instant Reply
 * picker on a received mail.
 *
 * API calls only ever run as personal-3 (qatest3) — the browser account is never logged in through
 * the API (one session per account).
 */
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;

test.describe(
  'KPost KMail · settings take effect @ui',
  { tag: ['@ui', '@kmail', '@regression'] },
  () => {
    test.describe.configure({ timeout: 150_000 });
    test.skip(
      process.env.SETTINGS_UI_LIFECYCLE !== 'true',
      'changes KMail settings; set SETTINGS_UI_LIFECYCLE=true',
    );
    test.skip(!testData.kpostId, 'needs the primary QA account');

    /** Collect every non-GET request to the KPost / KMail APIs while `run` executes. */
    async function writesDuring(page: Page, run: () => Promise<void>): Promise<string[]> {
      const seen: string[] = [];
      const onRequest = (r: Request) => {
        if (r.method() !== 'GET' && /testingapi|testkmail/.test(r.url())) {
          seen.push(`${r.method()} ${r.url().replace(/^https:\/\/[^/]+/, '')}`);
        }
      };
      page.on('request', onRequest);
      try {
        await run();
        // A fixed window on purpose: the check is that NO save request fires, so there is no event to
        // wait for — give any request 3 s to appear before reading the list.
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(3_000);
      } finally {
        page.off('request', onRequest);
      }
      return seen;
    }

    test('Mail Signature: a saved signature is still there after a reload @ui', async ({
      page,
      settingsPage,
    }) => {
      const designation = `QA Designation ${Date.now()}`;
      await settingsPage.goto();
      await settingsPage.openPanel('KMail Settings', 'Mail Signature');
      await page.getByPlaceholder('Enter your First Name').first().fill('QA');
      await page.getByPlaceholder('Enter your Last Name').first().fill('Signature');
      await page.getByPlaceholder('Enter Designation').first().fill(designation);
      await page.getByPlaceholder('Enter your Email ID').first().fill(testData.kpostId);
      const writes = await writesDuring(page, () =>
        page
          .getByRole('button', { name: /^Save$/i })
          .first()
          .click({ timeout: 8_000 }),
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      await settingsPage.openPanel('KMail Settings', 'Mail Signature');
      const kept = await page
        .getByPlaceholder('Enter Designation')
        .first()
        .inputValue()
        .catch(() => '');
      const observed = `requests on Save: ${writes.length ? writes.join(' ; ') : 'none'} | designation after reload: "${kept}"`;
      test.info().annotations.push({ type: 'observed', description: observed });
      console.log(`KMAIL-SETTINGS signature ${observed}`);
      const shot = test.info().outputPath('signature-after-reload.png');
      await page.screenshot({ path: shot });
      await test.info().attach('signature-after-reload', { path: shot, contentType: 'image/png' });
      expect(writes.length, `Save sends the signature to the server (${observed})`).toBeGreaterThan(
        0,
      );
      expect(kept, `the saved signature is still there after a reload (${observed})`).toBe(
        designation,
      );
    });

    test('Vacation Response: a saved vacation response is still there after a reload @ui', async ({
      page,
      settingsPage,
    }) => {
      const response = `QA out of office ${Date.now()}`;
      await settingsPage.goto();
      await settingsPage.openPanel('KMail Settings', 'Vacation Response');
      await page.getByPlaceholder('From').first().fill('2026-11-01');
      await page.getByPlaceholder('To').first().fill('2026-11-10');
      await page.getByPlaceholder('Enter the Vacation Response').first().fill(response);
      await page
        .getByPlaceholder('Enter the Vacation Message')
        .first()
        .fill('QA: I am away and will reply when I am back.');
      const writes = await writesDuring(page, () =>
        page
          .getByRole('button', { name: /^Save$/i })
          .first()
          .click({ timeout: 8_000 }),
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      await settingsPage.openPanel('KMail Settings', 'Vacation Response');
      const kept = await page
        .getByPlaceholder('Enter the Vacation Response')
        .first()
        .inputValue()
        .catch(() => '');
      const observed = `requests on Save: ${writes.length ? writes.join(' ; ') : 'none'} | response after reload: "${kept}"`;
      test.info().annotations.push({ type: 'observed', description: observed });
      console.log(`KMAIL-SETTINGS vacation ${observed}`);
      const shot = test.info().outputPath('vacation-after-reload.png');
      await page.screenshot({ path: shot });
      await test.info().attach('vacation-after-reload', { path: shot, contentType: 'image/png' });
      expect(
        writes.length,
        `Save sends the vacation response to the server (${observed})`,
      ).toBeGreaterThan(0);
      expect(kept, `the saved vacation response is still there after a reload (${observed})`).toBe(
        response,
      );
    });

    test('Instant Reply: a reply added in Settings is offered in KMail’s Instant Reply picker @ui', async ({
      page,
      settingsPage,
      endpoints,
    }) => {
      const marker = `QA instant ${Date.now()}`;
      await settingsPage.goto();
      await settingsPage.openPanel('KMail Settings', 'Instant Reply');
      await page.getByRole('button', { name: 'Add' }).first().click({ timeout: 10_000 });
      const field = page.getByRole('textbox', { name: 'Enter your Instant Reply' });
      await field.click();
      await field.fill(marker);
      await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
      await expect(page.getByText(marker).first(), 'the reply is added in Settings').toBeVisible({
        timeout: 15_000,
      });

      // A received mail to open (qatest3 → qatest1, through the API as qatest3).
      const subject = `QA KMail instant setting ${Date.now()}`;
      const sent = await endpoints.sendTo(
        'kmail-post-mail',
        { body: mailShape({ toAddress: testData.kpostId, kmailSubject: subject }) },
        { label: 'settings:seed-mail', auth: { principal: C }, allowLiveWrite: true },
      );
      expect(sent.status, 'qatest3 sends qatest1 a mail').toBe(200);

      await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      await page.locator('.Serach_input').first().fill(subject);
      await page.getByText(subject, { exact: false }).first().click({ timeout: 30_000 });
      await expect(page.getByText(`Sub : ${subject}`, { exact: false }).first()).toBeVisible({
        timeout: 20_000,
      });
      await page.getByTestId('ReplyIcon').first().click();
      await page
        .locator('[role="menu"]')
        .getByText('Instant Reply', { exact: true })
        .first()
        .click();
      await expect(page.getByText('Instant Reply', { exact: true }).last()).toBeVisible({
        timeout: 10_000,
      });
      const shot = test.info().outputPath('instant-picker.png');
      await page.screenshot({ path: shot });
      await test.info().attach('instant-picker', { path: shot, contentType: 'image/png' });
      await expect(
        page.getByText(marker, { exact: false }).first(),
        'the reply added in Settings is offered in the Instant Reply picker',
      ).toBeVisible({ timeout: 10_000 });
    });
  },
);
