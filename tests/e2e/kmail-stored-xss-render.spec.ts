import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Stored-XSS verification for KMail's thread-view mail-bubble renderer.
 *
 * A ground-truth source audit of `KmailMessageBox.js` (the mail-bubble renderer) found the mail BODY
 * rendered via `dangerouslySetInnerHTML` (`.para_fontkm.ql-editor...parent-container`,
 * `__html: normalizedPara`) with NO sanitization applied at render time: the file imports DOMPurify
 * and defines its own `sanitizeHTML` helper, but the only call site is commented out — dead code.
 *
 * `kmail-security.spec.ts` only proves the SENDER's own compose screen never executes a payload right
 * after sending. It never reopens the thread to see whether the body executes on RENDER, which is the
 * actual `dangerouslySetInnerHTML` code path the audit flagged — a payload that is inert on the
 * sender's compose screen could still be live when a RECEIVER's thread view renders it from storage.
 * This test closes that specific gap: account A sends a real mail to account B
 * (`testData.victimKpostId`); account B opens it in a second browser context (the `STORAGE_STATE_2`
 * pattern from `katchup-two-session.spec.ts`); we check whether the payload executes when account B's
 * thread view renders the stored body.
 *
 * Payload form: a literal `<script>` tag inserted via `dangerouslySetInnerHTML` never executes in a
 * real browser (the HTML parser does not run script elements inserted this way) — only an
 * event-handler payload (`onerror` on an `<img>`) does, so that is the form used here.
 *
 * Same execution-based check as every other `*-security.spec.ts` file in this bench: a global flag
 * the payload's own `onerror` sets (not string-matching), a `dialog` listener, and `watchUiHealth` for
 * any uncaught JS error — PLUS a direct read of the rendered body's `innerHTML` as supporting evidence
 * either way: did the raw, unescaped markup survive into the live DOM, or was it neutralised upstream
 * of the renderer (e.g. by the compose editor's own serialisation) before ever reaching
 * `dangerouslySetInnerHTML`? Either outcome is useful evidence; the test asserts the CORRECT (secure)
 * behaviour so a live failure is the proof.
 *
 * Gated exactly like `kmail-security.spec.ts` (`KMAIL_UI_LIFECYCLE=true`, both QA accounts configured)
 * PLUS `KATCHUP_UI_LIFECYCLE=true`, which is what makes `auth2.setup.ts` actually log STORAGE_STATE_2
 * in as the real 2nd QA account instead of saving an anonymous session (see `auth2.setup.ts`).
 *
 * KMail has no recall, so — like `kmail-security.spec.ts` — this does NOT clean up after itself; it
 * leaves one real mail in the 2nd QA account's inbox.
 */
test.describe('KPost KMail · stored XSS on thread-view render', { tag: '@ui' }, () => {
  test.skip(
    process.env.KMAIL_UI_LIFECYCLE !== 'true',
    'sends a real mail; set KMAIL_UI_LIFECYCLE=true',
  );
  test.skip(
    process.env.KATCHUP_UI_LIFECYCLE !== 'true',
    'needs auth2.setup.ts to log STORAGE_STATE_2 in as a real 2nd account; set KATCHUP_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId ||
      testData.kpostId.includes('qa.bench') ||
      !testData.victimKpostId ||
      testData.victimKpostId.includes('qa.bench'),
    'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
  );

  test('an onerror-based payload in a received mail body must not execute when the receiver opens it @ui', async ({
    page,
    browser,
  }) => {
    const marker = `qaxss${Date.now()}`;
    const subject = `QA XSS RENDER ${marker}`;
    const payload = `<img src=x onerror="window.__xssFired=true">`;

    // --- Account A (sender, the default session): compose and send a real mail carrying the
    // payload in the BODY (the field the audit flagged; subject stays plain so the receiver-side
    // search match below is unambiguous). ---
    const stopSender = watchUiHealth(page);
    let dialogFiredSender = false;
    page.on('dialog', (dialog) => {
      dialogFiredSender = true;
      void dialog.dismiss();
    });

    await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    // Body FIRST — filling the To field opens a recipient autocomplete that destabilises the layout
    // (same proven order as `kmail-compose.spec.ts` / `kmail-security.spec.ts`).
    const body = page.locator('.ql-editor[contenteditable="true"]').first();
    await body.click({ force: true });
    await page.keyboard.type(`QA UI stored-XSS render check — ${payload}`);

    const to = page.locator('.subjectTextboxKmailTO, input[name="to"]').first();
    await to.click();
    await to.fill(testData.victimKpostId);
    await page
      .getByText(testData.victimKpostId, { exact: false })
      .last()
      .click({ timeout: 4_000 })
      .catch(() => undefined);

    await page.locator('.toInput').first().fill(subject);

    await page
      .locator('.post_button_size')
      .filter({ has: page.locator('.icon-KP_3164') })
      .first()
      .click()
      .catch(() => page.locator('.post_button_size').first().click());

    await expect(
      page
        .getByText(/sent|success/i)
        .first()
        .or(page.locator('.Toastify__toast--success').first()),
      'the mail was sent',
    ).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500);

    const healthSender = stopSender();
    // Logged as context, not asserted: the sender screen can throw unrelated JS errors (other
    // screen chrome, notification polling, etc.) that have nothing to do with THIS payload — that
    // general sender-screen health is already `kmail-security.spec.ts`'s job. The only thing this
    // test cares about on the sender side is that the payload itself never executes there either.
    test.info().annotations.push({
      type: 'observed-sender',
      description: `sender pageErrors: ${JSON.stringify(healthSender.pageErrors)}`,
    });
    expect(dialogFiredSender, 'the payload must not fire on the sender screen either').toBe(false);

    // --- Account B (the receiver): a second browser context restored from STORAGE_STATE_2, the
    // established two-session pattern (`katchup-two-session.spec.ts`). ---
    const context = await browser.newContext({ storageState: STORAGE_STATE_2 });
    const receiver = await context.newPage();
    try {
      const stopReceiver = watchUiHealth(receiver);
      let dialogFiredReceiver = false;
      receiver.on('dialog', (dialog) => {
        dialogFiredReceiver = true;
        void dialog.dismiss();
      });

      await receiver.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await receiver
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

      // Filter the recent-mail list down to our unique subject. `MessageContainer.js` filters its
      // mail list by `kmailSubject` against this search box (`.Serach_input`, `SearchBar.js`).
      const search = receiver.locator('.Serach_input').first();
      await search.fill(subject);
      await receiver.waitForTimeout(1_000);

      const received = receiver.getByText(subject, { exact: false }).first();
      await expect(received, 'account 2 receives the mail account 1 sent').toBeVisible({
        timeout: 25_000,
      });

      // Click the mail row to expand it — `KmailMessageBox.showMailContent()`, wired to the
      // collapsed row's own onClick — which is what actually renders the body through
      // `dangerouslySetInnerHTML` (the code path the source audit flagged).
      await received.click();

      const bodyLocator = receiver.locator('.para_fontkm.ql-editor.parent-container').first();
      await expect(bodyLocator, 'the mail body renders in the thread view').toBeVisible({
        timeout: 20_000,
      });
      await receiver.waitForTimeout(1_500); // let onerror fire if it's going to

      const fired = await receiver.evaluate(
        () => Boolean((window as unknown as Record<string, unknown>).__xssFired),
      );
      const rawHtml = await bodyLocator.innerHTML().catch(() => '(could not read innerHTML)');
      const health = stopReceiver();

      const summary =
        `__xssFired: ${fired}; dialog fired: ${dialogFiredReceiver}; ` +
        `pageErrors: ${JSON.stringify(health.pageErrors)}; ` +
        `rendered body innerHTML: ${rawHtml.slice(0, 1000)}`;
      test.info().annotations.push({ type: 'observed', description: summary });
      // Also on stdout so it shows up directly in the run log, not just the HTML report.
      // eslint-disable-next-line no-console
      console.log(`[kmail-stored-xss-render] ${summary}`);

      // NOTE: a pre-existing, unrelated `TypeError: Cannot read properties of undefined (reading
      // 'status')` fires on BOTH the sender and receiver screens regardless of this payload (seen
      // identically with the payload absent) — almost certainly a background notification/socket
      // poll race, not caused by this test. Logged for context, not asserted here; the two hard
      // gates below are what this test exists to prove.
      test.info().annotations.push({
        type: 'context-pageErrors',
        description: `receiver pageErrors (not asserted, see note above): ${JSON.stringify(health.pageErrors)}`,
      });

      expect(dialogFiredReceiver, 'no dialog fired rendering the received mail').toBe(false);
      expect(
        fired,
        'the onerror payload must not execute when the receiver opens the received mail',
      ).toBe(false);
    } finally {
      await context.close();
    }
  });
});
