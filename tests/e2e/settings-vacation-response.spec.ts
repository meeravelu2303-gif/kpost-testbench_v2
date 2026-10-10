import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Settings · Vacation Response panel (`Vacationresponse.js`) — no `Services/*` import, no API calls;
 * entirely local UI state. Confirmed from source, THREE separate real bugs worth exercising directly
 * rather than only reading about:
 *
 *  1. The on/off toggle sets a `disabled` attribute on a wrapping `<div>`, not on the actual inputs —
 *     `disabled` has no effect on a `<div>`, so the date/text controls below stay interactable no
 *     matter what the toggle shows.
 *  2. Both message `<textarea>` elements have a JSX typo, `v alue={value.textarea}` (two broken props
 *     instead of `value=`) — they are never actually React-controlled.
 *  3. "Save" is wired to `onClick={() => setValue("")}`, which replaces the whole `value` OBJECT state
 *     with a bare STRING — every other control in this component reads `value.from`/`value.to`/etc.,
 *     so this is a live crash candidate on the next render, not a cosmetic issue.
 *
 * This test exercises the full chain (From -> To -> Response -> Message -> Save) and watches for an
 * uncaught JS exception via `watchUiHealth`, rather than assuming the exact failure mechanism — the
 * observable outcome (does the screen actually break) is the honest thing to assert.
 */
test.describe('KPost Settings · Vacation Response panel', { tag: '@ui' }, () => {
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

    // Toggle once, whichever direction it lands in — the bug is that `disabled` on a wrapping <div>
    // has no effect on the real inputs regardless of which state the toggle shows.
    await page.locator('.icon-KP_289_Toggle-On, .icon-KP_285_Toggle-Off').first().click();
    await page.waitForTimeout(300);

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
    await page.waitForTimeout(1_500);

    const health = stop();
    test.info().annotations.push({
      type: 'observed',
      description: `page errors after clicking Save: ${JSON.stringify(health.pageErrors)}`,
    });

    // Predicted from source: Save replaces the whole `value` state object with a bare string, which
    // every other control in this component reads as an object (`value.from`, `value.to`, etc.) — if
    // that fires an uncaught exception on the next render, this is the evidence, not an assumption.
    expect(
      health.pageErrors,
      'Save is confirmed from source to call setValue("") — replacing an object-shaped state with a ' +
        'string — this asserts whether that actually throws on the live build',
    ).toEqual([]);
  });
});
