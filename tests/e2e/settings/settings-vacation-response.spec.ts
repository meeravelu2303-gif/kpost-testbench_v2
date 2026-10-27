import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * Settings › Vacation Response (local state only, no service): the toggle does not disable the inputs,
 * the textareas are never controlled, and Save replaces object state with a string. Asserts via watchUiHealth.
 */
test.describe(
  'KPost Settings · Vacation Response panel',
  { tag: ['@ui', '@settings', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('the on/off toggle is confirmed NOT to actually disable the fields below it @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('KMail Settings', 'Vacation Response');

      const fromInput = page.getByPlaceholder('From').first();
      await expect(fromInput, 'the panel renders with a From date field').toBeVisible({
        timeout: 15_000,
      });

      // Toggle once either way: `disabled` on a wrapping <div> has no effect on the real inputs.
      await page.locator('.icon-KP_289_Toggle-On, .icon-KP_285_Toggle-Off').first().click();
      await settleFrames(page);

      await expect(
        fromInput,
        'confirmed from source: the toggle disables a wrapping <div>, not the input — the From field ' +
          'stays interactable regardless of the toggle state, which is a real UX bug (the on/off ' +
          'control visually implies it gates editing, but does not)',
      ).toBeEnabled();
    });

    test('completing the full chain (From -> To -> Response -> Message) and clicking Save does not crash the page @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('KMail Settings', 'Vacation Response');

      const stop = watchUiHealth(page);

      const fromInput = page.getByPlaceholder('From').first();
      await expect(fromInput, 'the From field renders').toBeVisible({ timeout: 15_000 });
      await fromInput.fill('2026-11-01');

      const toInput = page.getByPlaceholder('To').first();
      await expect(toInput, 'To becomes enabled once From is set').toBeEnabled({ timeout: 5_000 });
      await toInput.fill('2026-11-10');

      const responseInput = page.getByPlaceholder('Enter the Vacation Response').first();
      await expect(
        responseInput,
        'the Vacation Response input becomes enabled once To is set',
      ).toBeEnabled({ timeout: 5_000 });
      await responseInput.fill('Out of office');

      const messageTextarea = page.getByPlaceholder('Enter the Vacation Message').first();
      await expect(
        messageTextarea,
        'the Vacation Message textarea becomes enabled once Response is set',
      ).toBeEnabled({ timeout: 5_000 });
      await messageTextarea.fill('I am on vacation and will respond when I am back.');

      const saveButton = page.getByRole('button', { name: /^Save$/i });
      await expect(saveButton, 'Save becomes enabled once a message is entered').toBeEnabled({
        timeout: 5_000,
      });
      await saveButton.click();
      // Save makes no network call; two frames let any render-time throw surface first.
      await settleFrames(page);

      const health = stop();
      test.info().annotations.push({
        type: 'observed',
        description: `page errors after clicking Save: ${JSON.stringify(health.pageErrors)}`,
      });

      // Save replaces the `value` object state with a string; an uncaught exception here is the evidence.
      expect(
        health.pageErrors,
        'Save is confirmed from source to call setValue("") — replacing an object-shaped state with a ' +
          'string — this asserts whether that actually throws on the live build',
      ).toEqual([]);
    });
  },
);
