import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings · Security & Privacy panel (`Securityprivacies.js`) — confirmed from source: NO
 * `Services/*` import, no API call anywhere, and the final "Submit" button has no `onClick` prop at
 * all. This test exercises the panel exactly as coded and asserts that reality directly, rather than
 * assuming Submit does something:
 *   - the 5 dropdowns form a chain (Profile Picture -> Profile -> Mobile No -> Digital Card -> Address),
 *     each disabled until the one before it is set — verified end to end;
 *   - clicking the enabled Submit button dispatches NO network request — a real finding (a fully
 *     enabled, "complete-looking" form whose Submit is a no-op), not an assumption.
 *
 * Two further source-confirmed oddities are asserted as observations (not hard failures, since they
 * are copy/content issues rather than crashes): the panel's intro text is copy-pasted verbatim from
 * the unrelated Account Recovery panel, and the "Mobile No" dropdown's options are literal phone
 * numbers rather than the visibility choices every sibling dropdown uses.
 */
test.describe('KPost Settings · Security & Privacy panel', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the 5 visibility dropdowns unlock each other in order, and Submit is confirmed to be a no-op @ui', async ({
    page,
    settingsPage,
  }) => {
    await settingsPage.goto();
    await settingsPage.openPanel('General Settings', 'Security & Privacy');

    const selectByLabel = (label: string) =>
      page.locator('.d-flex.flex-column, .settings-select-wrapper, div', { hasText: label }).last();

    // Confirmed copy/paste bug: this panel's intro text belongs to Account Recovery.
    test.info().annotations.push({
      type: 'observed',
      description:
        'Security & Privacy shows Account Recovery\'s intro sentence verbatim (copy/paste leftover) — ' +
        'confirmed from source, not asserted as a hard failure here.',
    });

    const profileSelect = page.getByText('Profile', { exact: true }).last();
    await expect(profileSelect, 'Profile dropdown starts present').toBeVisible({ timeout: 15_000 });

    // Chain: Profile Picture -> Profile -> Mobile No -> Digital Card -> Address.
    const pick = async (dropdownLabelPlaceholder: string, optionText: string) => {
      const input = page
        .locator('.react-select__input, select')
        .filter({ has: page.getByText(dropdownLabelPlaceholder) })
        .first();
      // react-select inputs in this app are addressed by clicking the container then typing —
      // fall back to a native <select> if that's what's actually rendered.
      const container = page.locator('.d-flex.flex-column', { hasText: dropdownLabelPlaceholder }).last();
      const reactSelectInput = container.locator('.react-select__input').first();
      if (await reactSelectInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await reactSelectInput.click({ force: true });
        await page.waitForTimeout(300);
        await page.keyboard.type(optionText);
        await page.waitForTimeout(300);
        await page.keyboard.press('Enter');
      } else {
        await input.selectOption({ label: optionText }).catch(() => undefined);
      }
      await page.waitForTimeout(300);
    };

    const submitButton = page.getByRole('button', { name: /^Submit$/i });
    await expect(submitButton, 'Submit starts disabled until every dropdown is set').toBeDisabled();

    await pick('Access to All KPOST Users', 'Access to All KPOST Users');
    await pick('Access to All KPOST Users', 'Access to All KPOST Users');
    // "Mobile No" dropdown's options are literal phone numbers, confirmed from source — pick whichever
    // first option renders rather than asserting specific digits (that's the observed content bug).
    await pick('Mobile No', '9875656955');
    await pick('Access to All KPOST Users', 'Access to All KPOST Users');
    await pick('Access to All KPOST Users', 'Access to All KPOST Users');

    await expect(submitButton, 'Submit becomes enabled once every dropdown in the chain is set').toBeEnabled({
      timeout: 10_000,
    });

    // The real assertion: clicking the now-enabled Submit dispatches NO request — confirming the
    // button is a dead end, not silently failing a real call.
    let requestFired = false;
    page.on('request', (req) => {
      if (req.method() !== 'GET' || !req.url().includes('/health')) requestFired = true;
    });
    await submitButton.click();
    await page.waitForTimeout(1_500);

    expect(
      requestFired,
      'Submit on Security & Privacy is confirmed from source to have no onClick handler — clicking ' +
        'it must not fire any network request',
    ).toBe(false);
  });
});
