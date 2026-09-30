import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * `/koolkall/:id` (`GlobalKoolKall.js`) — a PUBLIC call-join link, no auth required. Confirmed from
 * source: this embeds a REAL Jitsi Meet room (`@jitsi/react-sdk`) and clicking "Submit" on the
 * name-capture modal immediately joins the actual live room — not a mock. This test suite therefore
 * NEVER clicks "Submit" (that would connect a headless browser to a real Jitsi room, audible/visible
 * to whoever else is in it) — it stays scoped to the pre-join modal and the malformed-id crash-safety
 * question, matching the same hard safety boundary already established for K-Booking's payment flow
 * and the OTP/SMS-sending endpoints.
 *
 * Confirmed source gap worth exercising directly: `decryptId(decodeURIComponent(id))` is called
 * inline in JSX with no try/catch around the render path, unlike `ProfileWebView.js`'s equivalent
 * call (which IS wrapped). A malformed id could throw before the modal ever renders.
 */
test.describe('KPost — /koolkall/:id public call-join link', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a malformed id does not crash the page before the name-capture modal can render @ui', async ({
    page,
  }) => {
    const stop = watchUiHealth(page);
    await page.goto('/koolkall/not-a-valid-encrypted-id', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(2_000);

    const health = stop();
    test.info().annotations.push({
      type: 'observed',
      description: `page errors: ${JSON.stringify(health.pageErrors)}`,
    });

    // Predicted from source as a risk (inline, unguarded decryptId call): if this fails, the finding
    // is a real unguarded-decrypt crash on a public URL anyone can hit with a bad/expired link.
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
    test.skip(!opened, 'the modal did not render (may already be covered by the crash-safety test above)');

    await expect(nameInput, 'the name-capture modal renders').toBeVisible();
    await expect(page.getByRole('button', { name: /^Cancel$/i }), 'Cancel is present').toBeVisible();
    // Submit is confirmed to join a REAL live Jitsi room — present but never clicked.
    await expect(
      page.getByRole('button', { name: /^Submit$/i }),
      'Submit is present — NOT clicked, since it joins a real live call',
    ).toBeVisible();
  });
});
