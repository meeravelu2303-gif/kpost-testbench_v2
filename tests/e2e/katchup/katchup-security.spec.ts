import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { EDITOR, openBellMenu, openComposerFor, submitComposer } from '../support/katchup';
import { settleFrames } from '../support/settle';

/**
 * Katchup composer XSS fuzzing (Subject + body): a stored payload must render inert, judged by a
 * `dialog` listener rather than string matching. Each message is sent for real, then recalled.
 */
test.describe(
  'KPost Katchup · composer security fuzzing',
  {
    tag: ['@ui', '@katchup', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
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

        // Our own thread renders the message first, so a payload would execute here first.
        await expect(
          page.getByText(subject).first(),
          'the sent message appears, rendered as text',
        ).toBeVisible({
          timeout: 20_000,
        });
        await settleFrames(page);

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

        // Recall, not delete: delete only hides it from our view, recall unsends it for the receiver too.
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
  },
);
