import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * Injection payloads in the login id field (a read-only lookup) must not crash the page or execute.
 * Execution is detected by a dialog listener, not by string-matching the DOM: an input legitimately
 * echoes its typed value.
 */
test.describe(
  'KPost login · security fuzzing',
  {
    tag: ['@ui', '@auth', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    const PAYLOADS: Array<{ name: string; value: string }> = [
      { name: 'script tag', value: '<script>alert(1)</script>' },
      { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
      { name: 'SQL-style OR-true', value: "' OR '1'='1" },
      { name: 'SQL-style comment terminator', value: "admin'--" },
      { name: 'template-literal injection', value: '${7*7}' },
    ];

    for (const payload of PAYLOADS) {
      test(`the login id field survives a ${payload.name} payload without crashing or executing it @ui`, async ({
        page,
        loginPage,
      }) => {
        const stop = watchUiHealth(page);
        let dialogFired = false;
        page.on('dialog', (dialog) => {
          dialogFired = true;
          void dialog.dismiss();
        });

        await page.goto(loginPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await loginPage.expectLoaded();

        await loginPage.loginIdInput.fill(payload.value);
        await loginPage.loginIdInput.press('Escape');
        await loginPage.loginIdInput.press('Enter');

        // Let the lookup settle, whichever way it resolves.
        await page
          .getByText(/doesn't exist|invalid/i)
          .first()
          .waitFor({ state: 'visible', timeout: 10_000 })
          .catch(() => undefined);
        // A dialog from an injected handler can fire slightly after the toast settles.
        await settleFrames(page, 3);

        const health = stop();

        test.info().annotations.push({
          type: 'observed',
          description: `page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
        });

        expect(
          health.pageErrors,
          `no uncaught JS error while processing: ${payload.value}`,
        ).toEqual([]);
        expect(
          dialogFired,
          `the payload must never execute (no alert/confirm/prompt fired) — reflected/DOM XSS: ${payload.value}`,
        ).toBe(false);
      });
    }
  },
);
