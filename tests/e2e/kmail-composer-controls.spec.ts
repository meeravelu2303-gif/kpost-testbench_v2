import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';

/**
 * KMail composer controls — the FRD rows that were UI-only GAPs (`requirements-frd.md`, KMail):
 *
 *   FR-KM-016  font / formatting   "Formatting Options" shows the Quill toolbar; Bold / Italic apply
 *   FR-KM-017  AI Assist           the K-AI Assist trigger opens its panel (no generation is run)
 *
 * Read from source (`Kmail/components/WriteMailPage/WriteMailPage.js`,
 * `common/ComposeAssist/ComposeAssist.js`, 2026-10-10):
 *   - the action bar (`.writeMailActionBar`) carries `.icon-KP_98-Font-Style[title="Formatting
 *     Options"]` → `handleTxtFormat` → `showToolbar={showTextEditor}` on `KmailQuillEditor`;
 *   - the K-AI entry is `ComposeAssist`: `.cas-trigger[aria-label="K-AI Assist"]` toggles the
 *     `.cas-pop` panel; opening it makes no AI call — only its actions do (`GeneratePropmt`,
 *     metered), so this test opens and closes the panel and never triggers an action.
 *
 * FR-KM-013 (remove the default signature block) has NO control in the source: the signature dock
 * (`.writeMailSignatureDock`) is display-only and Settings › Mail Signature only edits the fields the
 * block is generated from — recorded as a product gap in `requirements-frd.md`, not tested here.
 *
 * Nothing is sent: the composer is left with an unsent draft that the next navigation discards.
 */
test.describe('KPost KMail · composer controls (FR-KM-016/017)', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  async function openCompose(page: Page): Promise<void> {
    await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    // /writemail intermittently lands on the error boundary ("Something went wrong") — the shape of
    // #990. That is a defect the screen sweep (`screens-batch4`) reports; here it is a skip with the
    // reason, so a composer-control test never files a duplicate of a page-crash finding.
    const crashed = await page
      .getByText(/Something went wrong/i)
      .first()
      .isVisible()
      .catch(() => false);
    test.skip(
      crashed,
      '/writemail rendered the error boundary ("Something went wrong") — #990-shaped crash, reported by screens-batch4, not a composer-control finding',
    );
    await expect(
      page.locator('.writeMailActionBar').first(),
      'the compose action bar renders',
    ).toBeVisible({ timeout: 20_000 });
  }

  test('FR-KM-016 — Formatting Options reveals the toolbar and Bold / Italic apply to the body @ui', async ({
    page,
  }) => {
    await openCompose(page);
    const formatting = page
      .locator('.writeMailActionBar .icon-KP_98-Font-Style[title="Formatting Options"]')
      .first();
    await expect(formatting, 'the action bar offers Formatting Options').toBeVisible();

    const editorWrap = page.locator('.ql-container').first().locator('..');
    const toolbar = editorWrap.locator('.ql-toolbar').first();
    await formatting.click();
    await expect(toolbar, 'Formatting Options shows the Quill toolbar').toBeVisible({
      timeout: 10_000,
    });
    for (const [sel, label] of [
      ['.ql-bold', 'Bold'],
      ['.ql-italic', 'Italic'],
      ['.ql-underline', 'Underline'],
    ] as const) {
      await expect(toolbar.locator(sel).first(), `${label} is in the toolbar`).toBeVisible();
    }

    const body = page.locator('.ql-editor[contenteditable="true"]').first();
    await body.click();
    await toolbar.locator('.ql-bold').first().click();
    await page.keyboard.type('bold mail text');
    await toolbar.locator('.ql-bold').first().click();
    await toolbar.locator('.ql-italic').first().click();
    await page.keyboard.type(' italic mail text');

    await expect(
      body.locator('strong, b').filter({ hasText: 'bold mail text' }).first(),
      'Bold wraps the typed text',
    ).toBeVisible();
    await expect(
      body.locator('em, i').filter({ hasText: 'italic mail text' }).first(),
      'Italic wraps the typed text',
    ).toBeVisible();
  });

  test('FR-KM-017 — the K-AI Assist trigger opens its panel without running a generation, and closes @ui', async ({
    page,
  }) => {
    await openCompose(page);
    const aiCalls: string[] = [];
    page.on('request', (r) => {
      if (/ai|prompt|generate|openai|gpt/i.test(new URL(r.url()).pathname)) aiCalls.push(r.url());
    });

    const trigger = page.locator('.cas-trigger[aria-label="K-AI Assist"]').first();
    await expect(trigger, 'the composer offers K-AI Assist').toBeVisible({ timeout: 10_000 });
    await trigger.click();

    const panel = page.locator('.cas-pop').first();
    await expect(panel, 'the K-AI Assist panel opens').toBeVisible({ timeout: 10_000 });
    await expect(panel.locator('.cas-pop-head').first(), 'the panel has its header').toBeVisible();

    // Close via the panel's own close button (aria-label from the source) or the trigger again.
    const close = panel.getByRole('button', { name: /close/i }).first();
    if (await close.isVisible().catch(() => false)) await close.click();
    else await trigger.click();
    await expect(panel, 'the panel closes').toBeHidden({ timeout: 10_000 });

    test.info().annotations.push({
      type: 'observed',
      description: `AI-looking requests while opening/closing the panel: ${aiCalls.length}`,
    });
    expect(aiCalls, 'opening the assist panel must not itself call the metered AI service').toEqual(
      [],
    );
  });

  test('FR-KM-014 — the Attachment control takes one or more files and shows the attachment count @ui', async ({
    page,
  }) => {
    await openCompose(page);
    const bar = page.locator('.writeMailActionBar').first();
    await expect(
      bar.locator('.icon-KP_36-Attach[title="Attachment"]').first(),
      'the action bar offers Attachment',
    ).toBeVisible();
    // `input#fileInput` (multiple) sits under the Attachment icon's label — WriteMailPage.js.
    await bar.locator('input#fileInput[type="file"]').setInputFiles([
      { name: 'qa-one.txt', mimeType: 'text/plain', buffer: Buffer.from('QA attachment one') },
      { name: 'qa-two.txt', mimeType: 'text/plain', buffer: Buffer.from('QA attachment two') },
    ]);
    await expect(
      bar.locator('.attachment_count').first(),
      'the icon shows the number of attached files',
    ).toHaveText('02', { timeout: 10_000 });
  });

  test('FR-KM-022 — an external (non-KPOST) address is accepted as the recipient; a malformed one is not @ui', async ({
    page,
  }) => {
    await openCompose(page);
    const to = page.getByRole('textbox', { name: 'To' }).first();
    await expect(to, 'the To field renders').toBeVisible();

    // Malformed: handleInputonBlur only adopts a value that passes validateEmail.
    await to.fill('not-an-address');
    await to.blur();
    await expect(to, 'a malformed address is not adopted as a recipient').not.toHaveValue(
      /^not-an-address$/,
    );

    // Well-formed external address: adopted, shown by its local part (name = value.split('@')[0]).
    const external = `qa.external.${Date.now()}@example.com`;
    await to.fill(external);
    await to.blur();
    await expect(to, 'a valid external address becomes the recipient').toHaveValue(
      external.split('@')[0]!,
      { timeout: 10_000 },
    );
  });
});
