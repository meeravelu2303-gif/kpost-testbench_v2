import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings · Add Other Mail Accounts panel (`Othermail.js`) — confirmed from source: no
 * `Services/*` import, no KPost API call. Picking a provider then "Next" only opens a hardcoded
 * Google sign-in URL in a new tab (intercepted here, never actually navigated to).
 *
 * #923 (KP-OTHERMAILMISLABELED) is CONFIRMED FIXED as of 2026-10-04: the provider dropdown now reads
 * "Mail Provider" / "Select your email provider", and the second dropdown reads "Gmail ID: " /
 * "Select your Gmail ID" — no more "Vacation Response" copy-paste. This file is rewritten around the
 * current, correct labels.
 *
 * Re-reading the fixed source surfaced a second, SEPARATE, still-open defect in the same component's
 * validation logic (`handlenavigatepage`):
 *
 *   const isGmail = (event) => {
 *     setReason(event);
 *     if (event.label === "Gmail") setGmailopen(true);   // boolean true, NOT the picked Gmail ID
 *     else setGmailopen(false);
 *   };
 *   const handlenavigatepage = () => {
 *     if (gmailopen) { ...encodeURIComponent(gmailopen.value)... window.open(url) }
 *     else { alert("Please select a Gmail ID before proceeding."); }
 *   };
 *
 * The "Next" button itself only renders inside `{gmailopen && (...)}` — so by the time Next is ever
 * clickable, `gmailopen` is already truthy, which means `if (gmailopen)` inside `handlenavigatepage`
 * is ALWAYS true when reachable: the `else { alert(...) }` validation branch is structurally dead code,
 * unreachable through the UI. Worse, if the user picks "Gmail" as the provider and clicks Next WITHOUT
 * ever choosing a specific Gmail ID from the second dropdown, `gmailopen` is still the bare boolean
 * `true` (not an option object), so `gmailopen.value` is `undefined` and the opened Google sign-in URL
 * literally contains `Email=undefined` — silently, with no validation at all.
 */
test.describe('KPost Settings · Add Other Mail Accounts panel', { tag: '@ui' }, () => {
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

    const providerControl = page.getByText('Select your email provider', { exact: true }).first();
    await expect(
      providerControl,
      'the (correctly labelled) Mail Provider control renders',
    ).toBeVisible({
      timeout: 15_000,
    });
    await providerControl.click({ force: true });
    await page.locator('.react-select__menu').getByText('Yahoo Gmail', { exact: true }).click();

    // Confirmed from source: Next (and the Gmail ID picker) only render inside `{gmailopen && (...)}`,
    // and a non-Gmail provider sets `gmailopen` to the boolean `false` — so Next must never appear.
    await expect(
      page.getByRole('button', { name: /^Next$/i }),
      'a non-Gmail provider must never expose a Next button — confirming the validation alert ' +
        '("Please select a Gmail ID before proceeding") can never actually fire through the UI',
    ).toHaveCount(0);
  });

  test('picking Gmail but no specific Gmail ID, then Next, opens a broken sign-in URL with "Email=undefined" @ui', async ({
    page,
    context,
    settingsPage,
  }) => {
    await settingsPage.goto();
    await settingsPage.openPanel('KMail Settings', 'Add Other Mail Accounts');

    const providerControl = page.getByText('Select your email provider', { exact: true }).first();
    await expect(providerControl, 'the Mail Provider control renders').toBeVisible({
      timeout: 15_000,
    });
    await providerControl.click({ force: true });
    await page.locator('.react-select__menu').getByText('Gmail', { exact: true }).click();

    const nextButton = page.getByRole('button', { name: /^Next$/i });
    await expect(
      nextButton,
      'choosing Gmail reveals Next immediately — before any specific Gmail ID is picked',
    ).toBeVisible({ timeout: 10_000 });

    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 10_000 }),
      nextButton.click(),
    ]);

    // Confirmed from source: no validation alert fires here (the else-branch is unreachable), and
    // `gmailopen` is still the bare boolean `true`, so `gmailopen.value` is `undefined`.
    expect(
      popup.url(),
      'with no Gmail ID ever chosen, the opened URL carries the literal string "Email=undefined" — ' +
        'proof the validation guard never ran',
    ).toContain('Email=undefined');
    await popup.close();
  });

  test('selecting a specific Gmail ID, then Next, opens Google sign-in with that email @ui', async ({
    page,
    context,
    settingsPage,
  }) => {
    await settingsPage.goto();
    await settingsPage.openPanel('KMail Settings', 'Add Other Mail Accounts');

    const providerControl = page.getByText('Select your email provider', { exact: true }).first();
    await expect(providerControl, 'the Mail Provider control renders').toBeVisible({
      timeout: 15_000,
    });
    await providerControl.click({ force: true });
    await page.locator('.react-select__menu').getByText('Gmail', { exact: true }).click();

    const gmailIdControl = page.getByText('Select your Gmail ID', { exact: true }).first();
    await expect(gmailIdControl, 'choosing Gmail reveals the Gmail ID picker').toBeVisible({
      timeout: 10_000,
    });
    await gmailIdControl.click({ force: true });
    await page
      .locator('.react-select__menu')
      .getByText('ramraj1985@gmail.com', { exact: true })
      .click();

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
});
