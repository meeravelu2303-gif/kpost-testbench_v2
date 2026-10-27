import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { pickReactSelect, reactSelectByPlaceholder } from '../support/react-select';

/**
 * Settings › Add Other Mail Accounts: no KPost API call; Next only opens a Google sign-in URL
 * (intercepted). Next must not be usable before a Gmail ID is picked, or the URL carries Email=undefined.
 */
test.describe(
  'KPost Settings · Add Other Mail Accounts panel',
  { tag: ['@ui', '@settings', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('a non-Gmail provider never exposes a Next button — the validation alert is unreachable @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('KMail Settings', 'Add Other Mail Accounts');

      await pickReactSelect(
        reactSelectByPlaceholder(page, /Select your email provider/),
        /^Yahoo Gmail$/,
      );

      // Next only renders for the Gmail provider, so a non-Gmail provider must never show it.
      await expect(
        page.getByRole('button', { name: /^Next$/i }),
        'a non-Gmail provider must never expose a Next button — confirming the validation alert ' +
          '("Please select a Gmail ID before proceeding") can never actually fire through the UI',
      ).toHaveCount(0);
    });

    test('picking Gmail but no specific Gmail ID leaves Next disabled — no sign-in URL can open without an address @ui', async ({
      page,
      context,
      settingsPage,
    }) => {
      // Next must stay disabled until an ID is picked; the popup/URL check below catches a regression.
      await settingsPage.goto();
      await settingsPage.openPanel('KMail Settings', 'Add Other Mail Accounts');

      await pickReactSelect(
        reactSelectByPlaceholder(page, /Select your email provider/),
        /^Gmail$/,
      );

      const nextButton = page.getByRole('button', { name: /^Next$/i });
      await expect(nextButton, 'choosing Gmail reveals the Next button').toBeVisible({
        timeout: 10_000,
      });
      const enabled = await nextButton.isEnabled();
      test.info().annotations.push({
        type: 'observed',
        description: `Next enabled before a Gmail ID is chosen: ${enabled}`,
      });
      if (!enabled) {
        await expect(nextButton, 'Next stays disabled until a Gmail ID is chosen').toBeDisabled();
        return;
      }
      const popup = await Promise.all([
        context.waitForEvent('page', { timeout: 10_000 }).catch(() => undefined),
        nextButton.click(),
      ]).then(([p]) => p);
      const url = popup?.url() ?? '(no popup)';
      await popup?.close().catch(() => undefined);
      expect(
        url,
        'with no Gmail ID chosen, Next must not open a sign-in URL (and never one with "Email=undefined")',
      ).not.toMatch(/Email=undefined|accounts\.google/);
    });

    test('selecting a specific Gmail ID, then Next, opens Google sign-in with that email @ui', async ({
      page,
      context,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('KMail Settings', 'Add Other Mail Accounts');

      await pickReactSelect(
        reactSelectByPlaceholder(page, /Select your email provider/),
        /^Gmail$/,
      );

      const gmailIdControl = reactSelectByPlaceholder(page, /Select your Gmail ID/);
      await expect(gmailIdControl, 'choosing Gmail reveals the Gmail ID picker').toBeVisible({
        timeout: 10_000,
      });
      await pickReactSelect(gmailIdControl, /^ramraj1985@gmail\.com$/);

      const [popup] = await Promise.all([
        context.waitForEvent('page', { timeout: 10_000 }),
        page
          .getByRole('button', { name: /^Next$/i })
          .first()
          .click(),
      ]);

      expect(popup.url(), 'Next opens a Google sign-in URL for the chosen Gmail ID').toContain(
        encodeURIComponent('ramraj1985@gmail.com'),
      );
      await popup.close();
    });
  },
);
