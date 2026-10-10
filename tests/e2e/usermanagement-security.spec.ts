import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { openAddMemberForm, typeIntoDesignation } from './support/usermanagement';

/**
 * Security-fuzzing angle for User Management's **Designation** field — an async-search `react-select`
 * input in the "Add Manually" member form (`usermanagement.spec.ts`'s own selectors:
 * `.react-select__input` first, typed text, `Enter`). This is the field a fresh keystroke reaches
 * first and the only one probed here: the Mobile No / First Name fields sit BEHIND a same-company
 * collision guard that `usermanagement.spec.ts` deliberately never gets past with a fabricated value
 * (see that file's own "STOPS there" note — completing the flow provisions a real member account).
 * Fuzzing Designation keeps that same boundary: the form is never advanced past it, so Add is never
 * reachable. Same execution-based check as the other `*-security.spec.ts` files (a `dialog` listener,
 * not string-matching).
 */
test.describe(
  'KPost User Management · Designation field security fuzzing (BUSINESS_S)',
  { tag: '@ui' },
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

        // The moment that matters is when the async search answers and react-select renders the
        // result list (that is where a reflected payload would land), so wait for the menu rather
        // than a fixed pause. "No options" is a menu too. If no menu ever appears, that is recorded,
        // not failed — the assertions below are about execution, not about search results.
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
