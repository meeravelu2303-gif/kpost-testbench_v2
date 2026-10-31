import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { isKnownAppAlert } from '../support/known-dialogs';
import { settleFrames } from '../support/settle';
import { signedIn } from '@fixtures/login-gate';

/**
 * KMail stored XSS: account A mails an onerror payload to account B, whose thread view renders the
 * body via unsanitized dangerouslySetInnerHTML. Gated (KMAIL_ + KATCHUP_UI_LIFECYCLE); leaves one
 * real mail behind, since KMail has no recall. (A <script> tag never runs via innerHTML, so onerror.)
 */
test.describe(
  'KPost KMail · stored XSS on thread-view render',
  {
    tag: ['@ui', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      process.env.KMAIL_UI_LIFECYCLE !== 'true',
      'sends a real mail; set KMAIL_UI_LIFECYCLE=true',
    );
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'needs auth2.setup.ts to log STORAGE_STATE_2 in as a real 2nd account; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId ||
        testData.kpostId.includes('qa.bench') ||
        !testData.victimKpostId ||
        testData.victimKpostId.includes('qa.bench'),
      'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
    );

    test('an onerror-based payload in a received mail body must not execute when the receiver opens it @ui', async ({
      page,
      browser,
    }) => {
      const marker = `qaxss${Date.now()}`;
      const subject = `QA XSS RENDER ${marker}`;
      const payload = `<img src=x onerror="window.__xssFired=true">`;

      // Account A (sender): payload in the BODY; the subject stays plain so the receiver can search it.
      const stopSender = watchUiHealth(page);
      let dialogFiredSender = false;
      page.on('dialog', (dialog) => {
        if (!isKnownAppAlert(dialog)) dialogFiredSender = true;
        void dialog.dismiss();
      });

      await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

      // Body first: filling To opens an autocomplete that destabilises the layout.
      const body = page.locator('.ql-editor[contenteditable="true"]').first();
      await body.click();
      await page.keyboard.type(`QA UI stored-XSS render check — ${payload}`);

      const to = page.locator('.subjectTextboxKmailTO, input[name="to"]').first();
      await to.click();
      await to.fill(testData.victimKpostId);
      await page
        .locator('.suggestion-dropdown')
        .getByText(testData.victimKpostId, { exact: false })
        .first()
        .click({ timeout: 4_000 })
        .catch(() => undefined);

      await page.locator('.toInput').first().fill(subject);

      await page
        .locator('.post_button_size')
        .filter({ has: page.locator('.icon-KP_3164') })
        .first()
        .click()
        .catch(() => page.locator('.post_button_size').first().click());

      await expect(
        page
          .getByText(/sent|success/i)
          .first()
          .or(page.locator('.Toastify__toast--success').first()),
        'the mail was sent',
      ).toBeVisible({ timeout: 20_000 });
      await settleFrames(page);

      const healthSender = stopSender();
      // Sender page errors are logged, not asserted: unrelated errors there are kmail-security.spec.ts's job.
      test.info().annotations.push({
        type: 'observed-sender',
        description: `sender pageErrors: ${JSON.stringify(healthSender.pageErrors)}`,
      });
      expect(dialogFiredSender, 'the payload must not fire on the sender screen either').toBe(
        false,
      );

      // Account B (receiver): a second browser context from STORAGE_STATE_2.
      const context = await browser.newContext({ storageState: signedIn(STORAGE_STATE_2) });
      const receiver = await context.newPage();
      try {
        const stopReceiver = watchUiHealth(receiver);
        let dialogFiredReceiver = false;
        receiver.on('dialog', (dialog) => {
          if (!isKnownAppAlert(dialog)) dialogFiredReceiver = true;
          void dialog.dismiss();
        });

        await receiver.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await receiver
          .locator('.loader-overlay')
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .catch(() => undefined);

        // The search box filters the list by subject, client-side; the visibility wait below suffices.
        const search = receiver.locator('.Serach_input').first();
        await search.fill(subject);

        const received = receiver.getByText(subject, { exact: false }).first();
        await expect(received, 'account 2 receives the mail account 1 sent').toBeVisible({
          timeout: 25_000,
        });

        // Expanding the row renders the body through dangerouslySetInnerHTML.
        await received.click();

        const bodyLocator = receiver.locator('.para_fontkm.ql-editor.parent-container').first();
        await expect(bodyLocator, 'the mail body renders in the thread view').toBeVisible({
          timeout: 20_000,
        });
        // onerror fires when the image fails, so wait for the body's images to settle, not a delay.
        await bodyLocator
          .evaluate((el) =>
            Promise.all(
              Array.from(el.querySelectorAll('img')).map(
                (img) =>
                  new Promise<void>((done) => {
                    if (img.complete) return done();
                    img.addEventListener('load', () => done(), { once: true });
                    img.addEventListener('error', () => done(), { once: true });
                  }),
              ),
            ),
          )
          .catch(() => undefined);
        await settleFrames(receiver);

        const fired = await receiver.evaluate(() =>
          Boolean((window as unknown as Record<string, unknown>).__xssFired),
        );
        const rawHtml = await bodyLocator.innerHTML().catch(() => '(could not read innerHTML)');
        const health = stopReceiver();

        const summary =
          `__xssFired: ${fired}; dialog fired: ${dialogFiredReceiver}; ` +
          `pageErrors: ${JSON.stringify(health.pageErrors)}; ` +
          `rendered body innerHTML: ${rawHtml.slice(0, 1000)}`;
        test.info().annotations.push({ type: 'observed', description: summary });
        // Also on stdout so it shows up directly in the run log, not just the HTML report.

        console.log(`[kmail-stored-xss-render] ${summary}`);

        // Receiver page errors are context only: an unrelated background TypeError fires with or
        // without the payload.
        test.info().annotations.push({
          type: 'context-pageErrors',
          description: `receiver pageErrors (not asserted, see note above): ${JSON.stringify(health.pageErrors)}`,
        });

        // Precondition: an empty body proves nothing. Known defect #1348: opened mails show an empty body.
        expect(
          rawHtml.trim().length,
          'the received mail body actually renders (an empty body cannot prove the payload is inert — #1348)',
        ).toBeGreaterThan(0);
        expect(dialogFiredReceiver, 'no dialog fired rendering the received mail').toBe(false);
        expect(
          fired,
          'the onerror payload must not execute when the receiver opens the received mail',
        ).toBe(false);
      } finally {
        await context.close();
      }
    });
  },
);
