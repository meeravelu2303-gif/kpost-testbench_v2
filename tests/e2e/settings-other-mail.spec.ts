import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { pickReactSelect, reactSelectByPlaceholder } from './support/react-select';

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

    await pickReactSelect(
      reactSelectByPlaceholder(page, /Select your email provider/),
      /^Yahoo Gmail$/,
    );

    // Confirmed from source: Next (and the Gmail ID picker) only render inside `{gmailopen && (...)}`,
    // and a non-Gmail provider sets `gmailopen` to the boolean `false` — so Next must never appear.
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
    /*
     * History: until 2026-10-11 this test proved the opposite — Next was live before any Gmail ID
     * was chosen and opened Google sign-in with the literal "Email=undefined". The live build now
     * renders Next disabled until an ID is picked (screenshot 2026-10-11), so the assertion is the
     * correct behaviour; if Next ever becomes clickable again without an address, the popup/URL
     * check below catches the regression.
     */
    await settingsPage.goto();
    await settingsPage.openPanel('KMail Settings', 'Add Other Mail Accounts');

    await pickReactSelect(reactSelectByPlaceholder(page, /Select your email provider/), /^Gmail$/);

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

    await pickReactSelect(reactSelectByPlaceholder(page, /Select your email provider/), /^Gmail$/);

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
});
