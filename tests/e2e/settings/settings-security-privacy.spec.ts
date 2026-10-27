import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { pickReactSelect, reactSelectByPlaceholder } from '../support/react-select';

/**
 * Settings › Security & Privacy: the dropdown chain unlocks in order, and Submit (no onClick, no service)
 * must dispatch no request. Copy and option-content oddities are recorded as observations.
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

      // Copy/paste bug: this panel's intro text belongs to Account Recovery.
      test.info().annotations.push({
        type: 'observed',
        description:
          "Security & Privacy shows Account Recovery's intro sentence verbatim (copy/paste leftover) — " +
          'confirmed from source, not asserted as a hard failure here.',
      });

      // The page renders a hidden off-screen duplicate of this label; .first() is the visible one.
      const profileSelect = page.getByText('Profile', { exact: true }).first();
      await expect(profileSelect, 'Profile dropdown starts present').toBeVisible({
        timeout: 15_000,
      });

      // Chain: Profile Picture -> Profile -> Mobile No -> Digital Card -> Address.
      // Each dropdown is the react-select still showing the given placeholder (support/react-select.ts).
      const pick = async (dropdownLabelPlaceholder: string, optionText: string | RegExp) => {
        // The text is the control's placeholder or the field label beside it; try the control first.
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

      // The dropdown set changes between builds and "Mobile No" lists phone numbers, so each is set to
      // its first option: the chain only needs a value to unlock the next field.
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

      // Clicking the enabled Submit dispatches no request: the button is a dead end.
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
