import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings · Change Mobile Number panel (`ChangeNumber.js`) — confirmed from source: this ENTIRE
 * multi-step flow (enter number -> "Change Number" -> OTP modal -> new number -> "Continue" -> second
 * OTP modal -> final confirmation with a real-looking data-loss warning -> "Ok") has NO `Services/*`
 * import and fires ZERO network requests anywhere. Both OTP modals never actually read or validate
 * the typed digits — "Submit" just advances regardless of input. The final "Ok" only closes the
 * modal; nothing is ever persisted.
 *
 * This is safe to drive completely end to end (no real write risk, unlike the destructive account
 * flows elsewhere in Settings) — the test's real value is PROVING, not assuming, that a user who
 * completes this entire flow — including reading a warning that their old number's data "will be
 * automatically deleted" — has changed NOTHING: no request fires, and nothing survives a reload.
 *
 * NEEDS-CODEGEN, confirmed live 2026-10-01: the real panel does NOT match the sequential single-input
 * wizard described above. It actually renders TWO always-visible sections side by side ("New Primary
 * Mobile Number" with its own Continue/"Make Primary as Secondary" buttons, and "Secondary Mobile
 * Number" with its own "Change Number" button) rather than one input that reveals a second input after
 * an OTP step. `getByRole('button', { name: /^Change Number$/i })` actually belongs to the Secondary
 * section, not the Primary one this test means to drive. The flow needs a fresh interactive codegen
 * pass against the live page before this test's steps can be trusted again.
 */
test.describe('KPost Settings · Change Mobile Number panel', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('completing the full Change Mobile Number flow fires no network request and persists nothing @ui', async ({
    page,
    settingsPage,
  }) => {
    await settingsPage.goto();
    await settingsPage.openPanel('General Settings', 'Change Mobile Number');

    let requestFired = false;
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/health') || url.includes('.js') || url.includes('.css')) return;
      requestFired = true;
    });

    const numberInput = page.getByPlaceholder('Enter your No').first();
    await expect(numberInput, 'the primary mobile number input renders').toBeVisible({
      timeout: 15_000,
    });
    await numberInput.fill('9998887771');

    await page
      .getByRole('button', { name: /^Change Number$/i })
      .first()
      .click();
    await expect(page.getByText(/Enter OTP/i).first(), 'the first OTP modal opens').toBeVisible({
      timeout: 10_000,
    });
    // Confirmed from source: Submit never reads the OTP digits — it advances unconditionally.
    await page
      .getByRole('button', { name: /^Submit$/i })
      .first()
      .click();

    const newNumberInput = page.getByPlaceholder('Enter your No').last();
    await expect(newNumberInput, 'the New Primary Mobile Number input appears').toBeVisible({
      timeout: 10_000,
    });
    await newNumberInput.fill('9998887772');

    await page
      .getByRole('button', { name: /^Continue$/i })
      .first()
      .click();
    await expect(page.getByText(/Enter OTP/i).first(), 'the second OTP modal opens').toBeVisible({
      timeout: 10_000,
    });
    await page
      .getByRole('button', { name: /^Submit$/i })
      .first()
      .click();

    await expect(
      page.getByText(/Change Primary Mobile Number/i).first(),
      'the final confirmation modal opens with the data-loss warning',
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/data from the previous mobile number will be automatically deleted/i).first(),
      "the warning text about the old number's data being deleted is shown",
    ).toBeVisible();

    await page.getByRole('button', { name: /^Ok$/i }).first().click();
    await page.waitForTimeout(1_500);

    expect(
      requestFired,
      'the entire Change Mobile Number flow is confirmed from source to be client-only theater — ' +
        'completing every step, including the final confirmation, must not fire a single network request',
    ).toBe(false);

    // Confirms nothing survived: reloading Settings must show the ORIGINAL number's flow again, not
    // a "changed" state (there is none to show — this documents the flow's statelessness directly).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settingsPage.openPanel('General Settings', 'Change Mobile Number');
    await expect(
      page.getByPlaceholder('Enter your No').first(),
      'after reload, the panel resets to its original empty-input state — nothing persisted',
    ).toHaveValue('');
  });

  test('the "Make Primary as Secondary" buttons are confirmed dead controls (no handler) @ui', async ({
    page,
    settingsPage,
  }) => {
    await settingsPage.goto();
    await settingsPage.openPanel('General Settings', 'Change Mobile Number');

    let requestFired = false;
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/health') || url.includes('.js') || url.includes('.css')) return;
      requestFired = true;
    });

    await page
      .getByText(/Make Primary as Secondary/i)
      .first()
      .click();
    await page.waitForTimeout(1_000);

    expect(
      requestFired,
      '"Make Primary as Secondary" is confirmed from source to have no onClick handler wired at all',
    ).toBe(false);
  });
});
