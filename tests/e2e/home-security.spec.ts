import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Security-fuzzing angle for Home's two free-text inputs — the Recents search box (client-side
 * filter) and Advanced Search's "Enter Word" field (a separate control, submitted as part of a real
 * search request once a date range is also set — see `home-functional.spec.ts`'s own finding on the
 * Search button's date gate). Same execution-based XSS check as `login-security.spec.ts` (a `dialog`
 * listener, not string-matching — see that file's own doc comment for why a naive "does the payload
 * appear in the DOM" check produces false positives on any field that legitimately echoes back what
 * was typed).
 */
test.describe('KPost Home · search box security fuzzing', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  const PAYLOADS: Array<{ name: string; value: string }> = [
    { name: 'script tag', value: '<script>alert(1)</script>' },
    { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
    { name: 'SQL-style OR-true', value: "' OR '1'='1" },
  ];

  for (const payload of PAYLOADS) {
    test(`the Recents search box survives a ${payload.name} payload without crashing or executing it @ui`, async ({
      homePage,
      page,
    }) => {
      const stop = watchUiHealth(page);
      let dialogFired = false;
      page.on('dialog', (dialog) => {
        dialogFired = true;
        void dialog.dismiss();
      });

      await homePage.goto();
      await homePage.switchToRecentsTab();
      await homePage.searchRecents(payload.value);
      await page.waitForTimeout(1_500);

      const health = stop();

      test.info().annotations.push({
        type: 'observed',
        description: `page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
      });

      expect(health.pageErrors, `no uncaught JS error while filtering by: ${payload.value}`).toEqual([]);
      expect(
        dialogFired,
        `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
      ).toBe(false);
    });
  }
});

test.describe('KPost Home · Advanced Search "Enter Word" field security fuzzing', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  const PAYLOADS: Array<{ name: string; value: string }> = [
    { name: 'script tag', value: '<script>alert(1)</script>' },
    { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
    { name: 'SQL-style OR-true', value: "' OR '1'='1" },
  ];

  for (const payload of PAYLOADS) {
    test(`Advanced Search's Enter Word field survives a ${payload.name} payload and its submitted search does not execute it @ui`, async ({
      homePage,
      page,
    }) => {
      const stop = watchUiHealth(page);
      let dialogFired = false;
      page.on('dialog', (dialog) => {
        dialogFired = true;
        void dialog.dismiss();
      });

      await homePage.goto();
      await homePage.switchToRecentsTab();
      await homePage.openAdvancedSearch();
      // A date range is required to enable Search (home-functional.spec.ts's own documented gate) —
      // fill it alongside Word so the payload actually reaches a real submitted search, not just a
      // field that's never sent anywhere.
      await homePage.fillAdvancedSearch({
        word: payload.value,
        fromDate: '2026-01-01',
        toDate: '2026-09-30',
      });
      await expect(homePage.advancedSearchSubmitButton, 'Search becomes enabled').toBeEnabled({
        timeout: 10_000,
      });
      await homePage.advancedSearchSubmitButton.click();
      await page.waitForTimeout(1_500);

      const health = stop();

      test.info().annotations.push({
        type: 'observed',
        description: `page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
      });

      expect(health.pageErrors, `no uncaught JS error searching by: ${payload.value}`).toEqual([]);
      expect(
        dialogFired,
        `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
      ).toBe(false);
    });
  }
});
