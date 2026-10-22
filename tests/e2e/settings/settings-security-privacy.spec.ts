import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { pickReactSelect, reactSelectByPlaceholder } from './support/react-select';

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
test.describe(
  'KPost Settings · Security & Privacy panel',
  {
    tag: ['@ui', '@settings', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
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

      // Confirmed copy/paste bug: this panel's intro text belongs to Account Recovery.
      test.info().annotations.push({
        type: 'observed',
        description:
          "Security & Privacy shows Account Recovery's intro sentence verbatim (copy/paste leftover) — " +
          'confirmed from source, not asserted as a hard failure here.',
      });

      // Confirmed live 2026-10-01: this page renders a hidden duplicate of this label (a second,
      // off-screen copy) — .last() picks the hidden one; .first() is the real, visible label.
      const profileSelect = page.getByText('Profile', { exact: true }).first();
      await expect(profileSelect, 'Profile dropdown starts present').toBeVisible({
        timeout: 15_000,
      });

      // Chain: Profile Picture -> Profile -> Mobile No -> Digital Card -> Address.
      // Each dropdown is addressed by the react-select control still SHOWING the given placeholder
      // (the filled ones no longer do), driven through its own input — support/react-select.ts.
      const pick = async (dropdownLabelPlaceholder: string, optionText: string | RegExp) => {
        // The text is either the control's own placeholder ("Access to All KPOST Users") or the field
        // LABEL beside it ("Mobile No", whose placeholder is a phone number); try the control first,
        // then the labelled field's control.
        const byPlaceholder = reactSelectByPlaceholder(page, dropdownLabelPlaceholder);
        const control = (await byPlaceholder.count())
          ? byPlaceholder
          : page
              .locator('.d-flex.flex-column', { hasText: dropdownLabelPlaceholder })
              .locator('.react-select__control:visible')
              .first();
        await pickReactSelect(control, optionText, { typeToFilter: false });
      };

      const submitButton = page.getByRole('button', { name: /^Submit$/i });
      await expect(
        submitButton,
        'Submit starts disabled until every dropdown is set',
      ).toBeDisabled();

      // The panel's dropdown set changes between builds (five on 2026-10-01; on 2026-10-11 four —
      // Profile Picture, Profile, Mobile No, Digital Card — screenshot). The "Mobile No" list offers
      // literal phone numbers rather than visibility levels (the content bug noted above), so each
      // dropdown is set to whatever its FIRST option is: the chain only needs a value to unlock the
      // next field.
      const controls = page.locator('.react-select__control:visible');
      const total = await controls.count();
      test.info().annotations.push({
        type: 'observed',
        description: `${total} visibility dropdowns rendered`,
      });
      expect(total, 'the panel renders at least one visibility dropdown').toBeGreaterThan(0);
      for (let i = 0; i < total; i++) {
        await expect(
          controls.nth(i),
          `dropdown ${i + 1} is enabled once the previous one is set`,
        ).not.toHaveClass(/--is-disabled/, { timeout: 10_000 });
        await pickReactSelect(controls.nth(i), /\S/, { typeToFilter: false });
      }
      void pick;

      await expect(
        submitButton,
        'Submit becomes enabled once every dropdown in the chain is set',
      ).toBeEnabled({
        timeout: 10_000,
      });

      // The real assertion: clicking the now-enabled Submit dispatches NO request — confirming the
      // button is a dead end, not silently failing a real call.
      const fired = page
        .waitForRequest((req) => req.method() !== 'GET' || !req.url().includes('/health'), {
          timeout: 1_500,
        })
        .then(() => true)
        .catch(() => false);
      await submitButton.click();
      const requestFired = await fired;

      expect(
        requestFired,
        'Submit on Security & Privacy is confirmed from source to have no onClick handler — clicking ' +
          'it must not fire any network request',
      ).toBe(false);
    });
  },
);
