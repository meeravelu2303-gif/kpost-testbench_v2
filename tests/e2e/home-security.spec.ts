import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Security-fuzzing angle for the Home Recents search box — the counterpart to
 * `login-security.spec.ts`'s id-field fuzzing, applied to the first free-text input an authenticated
 * user reaches. Same execution-based XSS check (a `dialog` listener, not string-matching — see that
 * file's own doc comment for why a naive "does the payload appear in the DOM" check produces false
 * positives on any field that legitimately echoes back what was typed).
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
