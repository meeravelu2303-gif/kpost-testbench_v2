import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { openAddMemberForm, typeIntoDesignation } from '../support/usermanagement';

/**
 * Fuzzes the Designation react-select in User Management's Add Manually form and checks no payload
 * executes (a `dialog` listener). The form never advances, so no member is provisioned.
 */
test.describe(
  'KPost User Management · Designation field security fuzzing (BUSINESS_S)',
  {
    tag: ['@ui', '@user-management', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.use({ storageState: STORAGE_STATE_BUSINESS });

    test.skip(
      process.env.BUSINESS_UI_LIFECYCLE !== 'true',
      'needs the BUSINESS_S admin session; set BUSINESS_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.businessSKpostId || testData.businessSKpostId.includes('qa.business'),
      'needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID)',
    );

    const PAYLOADS: Array<{ name: string; value: string }> = [
      { name: 'script tag', value: '<script>alert(1)</script>' },
      { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
      { name: 'SQL-style OR-true', value: "' OR '1'='1" },
    ];

    for (const payload of PAYLOADS) {
      test(`the Designation search field survives a ${payload.name} payload without crashing or executing it @ui`, async ({
        page,
      }) => {
        const stop = watchUiHealth(page);
        let dialogFired = false;
        page.on('dialog', (dialog) => {
          dialogFired = true;
          void dialog.dismiss();
        });

        const modal = await openAddMemberForm(page);

        // Type into the real, visible control — the 4px-wide inner input needed a forced click.
        await typeIntoDesignation(page, modal, payload.value);

        // Wait for the result menu (where a reflected payload would land; "No options" counts).
        // No menu is recorded, not failed: the assertions are about execution.
        const menuAppeared = await page
          .locator('.react-select__menu')
          .first()
          .waitFor({ state: 'visible', timeout: 10_000 })
          .then(() => true)
          .catch(() => false);

        const health = stop();

        test.info().annotations.push({
          type: 'observed',
          description:
            `search menu rendered: ${menuAppeared}; page errors: ${JSON.stringify(health.pageErrors)}; ` +
            `dialog fired: ${dialogFired}`,
        });

        expect(health.pageErrors, `no uncaught JS error typing: ${payload.value}`).toEqual([]);
        expect(
          dialogFired,
          `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
        ).toBe(false);
      });
    }
  },
);
