import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { EDITOR, openBellMenu, openComposerFor, submitComposer } from './support/katchup';

/**
 * Security-fuzzing angle for the Katchup **composer** — Subject and message body — the highest-value
 * XSS surface in the whole app: unlike Home's search box (self-only, never leaves the searcher's own
 * session), a stored payload here is read back by a SECOND real account (the 2nd QA account), and by
 * every future viewer of the thread on either side. Same execution-based check as
 * `login-security.spec.ts`/`home-security.spec.ts` (a `dialog` listener, not string-matching — see
 * those files for why naive DOM string-matching produces false positives on any field that legitimately
 * echoes back what was typed).
 *
 * Sends via the shared `support/katchup` helpers (`submitComposer` presses Enter — the app's own send
 * trigger, immune to the composer's button layout — and `openBellMenu` handles the scroll/hover/force-
 * click sequence a still-rendering thread needs), rather than re-deriving those steps here.
 *
 * Each payload is sent for real (BR-K01 requires a Subject on every message) then immediately recalled
 * (unsent — FR-K10/BR-K03), matching `katchup-compose.spec.ts`'s own send-then-recall cleanup pattern,
 * so no fuzzed message is left in either account's history.
 */
test.describe('KPost Katchup · composer security fuzzing', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts',
  );

  const PAYLOADS: Array<{ name: string; value: string }> = [
    { name: 'script tag', value: '<script>alert(1)</script>' },
    { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
    { name: 'SQL-style OR-true', value: "' OR '1'='1" },
  ];

  for (const payload of PAYLOADS) {
    test(`a message carrying a ${payload.name} payload in Subject+body is stored and rendered inert, then recalled @ui`, async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      let dialogFired = false;
      page.on('dialog', (dialog) => {
        dialogFired = true;
        void dialog.dismiss();
      });

      const subject = `QA SEC ${Date.now()} ${payload.value}`;
      const body = `QA UI security fuzz — ${payload.value}`;

      await openComposerFor(page, testData.victimKpostId);
      await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
      await page.locator(EDITOR).first().click();
      await page.keyboard.type(body);
      await submitComposer(page);

      // The sent message renders back into OUR OWN thread immediately — if the payload were to
      // execute anywhere, this is the first and fastest place it would (before the 2nd account ever
      // opens the thread).
      await expect(
        page.getByText(subject).first(),
        'the sent message appears, rendered as text',
      ).toBeVisible({
        timeout: 20_000,
      });
      await page.waitForTimeout(1_500);

      const health = stop();

      test.info().annotations.push({
        type: 'observed',
        description: `page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
      });

      expect(health.pageErrors, `no uncaught JS error rendering: ${payload.value}`).toEqual([]);
      expect(
        dialogFired,
        `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
      ).toBe(false);

      // Clean up: recall OUR message (not `deleteSentMessage`, which only removes it from our own
      // view) so the fuzzed payload never reaches the 2nd account's own inbox — recall genuinely
      // unsends it (FR-K10/BR-K03), matching `katchup-compose.spec.ts`'s own cleanup.
      const sentMessage = page
        .locator('[id]')
        .filter({ hasText: subject })
        .filter({ has: page.getByTestId('NotificationsNoneIcon') })
        .last();
      await openBellMenu(page, sentMessage);
      const recall = page.getByRole('menuitem', { name: /Recall/i });
      await expect(recall, 'the message action menu offers Recall').toBeVisible({
        timeout: 15_000,
      });
      await recall.click();
      await expect(recall, 'the recall action was accepted (menu closed)').toHaveCount(0, {
        timeout: 15_000,
      });
    });
  }
});
