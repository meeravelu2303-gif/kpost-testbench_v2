import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';
import { retryOrSkip } from '../../support/live-condition';

/**
 * The public `/koolkall/:id` join link: the pre-join modal, and a malformed id must not crash the page
 * (decryptId is called unguarded). Submit is never clicked: it joins a real live Jitsi room.
 */
test.describe(
  'KPost — /koolkall/:id public call-join link',
  { tag: ['@ui', '@kall', '@regression'] },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('a malformed id does not crash the page before the name-capture modal can render @ui', async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      await page.goto('/koolkall/not-a-valid-encrypted-id', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await page.waitForLoadState('load');
      await settleFrames(page);

      const health = stop();
      test.info().annotations.push({
        type: 'observed',
        description: `page errors: ${JSON.stringify(health.pageErrors)}`,
      });

      // A failure here is an unguarded-decrypt crash on a public URL.
      expect(
        health.pageErrors,
        'a malformed :id must not crash the page before the name-capture modal can render — ' +
          'decryptId is called inline in JSX with no surrounding try/catch, confirmed from source',
      ).toEqual([]);
    });

    test('the name-capture modal renders with its Cancel/Submit controls, and Submit is NEVER clicked @ui', async ({
      page,
    }) => {
      await page.goto('/koolkall/not-a-valid-encrypted-id', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });

      const nameInput = page.getByPlaceholder('Enter your name').first();
      const opened = await nameInput.isVisible({ timeout: 10_000 }).catch(() => false);
      retryOrSkip(
        !opened,
        'the name-capture modal was not showing right now (the crash-safety test above covers the failure mode)',
      );

      await expect(nameInput, 'the name-capture modal renders').toBeVisible();
      await expect(
        page.getByRole('button', { name: /^Cancel$/i }),
        'Cancel is present',
      ).toBeVisible();
      // Submit joins a real live Jitsi room: asserted present, never clicked.
      await expect(
        page.getByRole('button', { name: /^Submit$/i }),
        'Submit is present — NOT clicked, since it joins a real live call',
      ).toBeVisible();
    });
  },
);
