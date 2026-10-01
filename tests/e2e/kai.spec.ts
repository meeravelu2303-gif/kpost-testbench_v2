import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * KOS · K-AI (`KAI.js`) — a real, backend-integrated AI chat (`Services/KOS.js`:
 * `GenerateAIResponse` -> `POST /v2/ai/chatResponse`, plus session history/messages GETs). Not a
 * stub. Scoped to render + a guarded empty-prompt check — a full generation round trip is
 * nondeterministic and potentially slow/costly, so it isn't driven to completion here.
 */
test.describe('KPost KOS · K-AI panel', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the K-AI panel renders its prompt input and History / Reset controls @ui', async ({
    page,
  }) => {
    await page.goto('/kdoc', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // K-AI is the default tool.
    await expect(
      page.getByPlaceholder(/Type your prompt or pick a suggestion|Ask .* /i).first(),
      'the prompt input renders',
    ).toBeVisible({ timeout: 15_000 });
    // Corrected from source (KAI.js): both are icon-only buttons carrying a `title` tooltip, not
    // visible text — "History" opens the session history panel, "Reset" clears the current chat
    // (there is no separate "New Chat" control on the default view; that text only exists inside
    // the history panel's own session sub-view).
    await expect(page.locator('[title="History"]').first(), 'the History control is present').toBeVisible();
    await expect(page.locator('[title="Reset"]').first(), 'the Reset control is present').toBeVisible();
  });

  test('submitting an empty prompt is guarded client-side, before any API call @ui', async ({
    page,
  }) => {
    await page.goto('/kdoc', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    let chatRequestFired = false;
    page.on('request', (req) => {
      if (req.url().includes('/ai/chatResponse')) chatRequestFired = true;
    });

    // Submitting via Enter with an empty textarea, if a send affordance is reachable without typing.
    const prompt = page.getByPlaceholder(/Type your prompt or pick a suggestion|Ask .* /i).first();
    await expect(prompt, 'the prompt input renders').toBeVisible({ timeout: 15_000 });
    await prompt.click();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1_000);

    expect(
      chatRequestFired,
      'an empty prompt is confirmed from source to be guarded ("Enter a prompt first.") — it must ' +
        'never reach the real chatResponse API',
    ).toBe(false);
  });
});
