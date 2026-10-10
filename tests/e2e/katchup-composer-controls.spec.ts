import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { EDITOR, openComposer } from './support/katchup';

/**
 * Katchup composer controls — the three FRD rows that were UI-only GAPs (`requirements-frd.md`):
 *
 *   FR-KU-004  full-screen composer   Maximize → full-screen state → Restore
 *   FR-KU-005  discard compose        Clear empties Subject and body and leaves the composer clean
 *   FR-KU-006  text formatting        Formatting toggle shows the Quill toolbar; Bold/Italic apply
 *
 * Every selector is read from the front-end source (`WriteMessage.js`, `QuillEditor.js`, bubble
 * variant, 2026-10-10), not guessed:
 *
 *   - the composer header carries, in the "Resize" state, `.icon-KP_313[title="Maximize"]`; in the
 *     "FullScreen" state `.icon-KP_312_Minimize[title="Restore"]`; the composer root gains
 *     `fullscreen_back_color write_pad` while full-screen;
 *   - `.icon-KP_29-Delete[title="Clear"]` runs `handleCloseEvent()`: subject and message reset,
 *     files, copies, secret options and schedule cleared, resize back to "Resize";
 *   - `.icon-KP_98-Font-Style[title="Formatting"]` toggles `showTextEditor`, which shows/hides the
 *     Quill toolbar (`.ql-toolbar`) and forces full-screen; the toolbar is configured with
 *     undo/redo, size, font, bold/italic/underline/strike, colour, clean, lists, code, link, image.
 *
 * Nothing here sends a message: every test ends on Clear, so the account is left as found.
 */
test.describe('KPost Katchup · composer controls (FR-KU-004/005/006)', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );
  test.skip(
    !testData.victimKpostId || testData.victimKpostId.includes('qa.victim'),
    'needs the 2nd QA account (QA_VICTIM_KPOST_ID) to open a conversation with',
  );

  // Everything is scoped to the composer root (`.writeMsg_mainDiv`, WriteMessage.js): Katchup renders
  // other Quill instances (message bodies, the forward footer) that share the `ql-*` classes.
  const composer = (page: Page) => page.locator('.writeMsg_mainDiv').first();
  const maximize = (page: Page) => composer(page).locator('.icon-KP_313[title="Maximize"]').first();
  const restore = (page: Page) =>
    composer(page).locator('.icon-KP_312_Minimize[title="Restore"]').first();
  const clear = (page: Page) => composer(page).locator('.icon-KP_29-Delete[title="Clear"]').first();
  const formatting = (page: Page) =>
    composer(page).locator('.icon-KP_98-Font-Style[title="Formatting"]').first();

  test.afterEach(async ({ page }) => {
    // Leave the composer empty whatever the test did (Clear is idempotent; ignore if already gone).
    await clear(page)
      .click({ timeout: 3_000 })
      .catch(() => undefined);
  });

  test('FR-KU-004 — Maximize puts the composer full-screen and Restore brings it back @ui', async ({
    page,
  }) => {
    await openComposer(page);
    await expect(maximize(page), 'the composer header offers Maximize').toBeVisible({
      timeout: 15_000,
    });

    await maximize(page).click();
    await expect(composer(page), 'the composer root takes the full-screen class').toHaveClass(
      /fullscreen_back_color/,
      { timeout: 10_000 },
    );
    await expect(restore(page), 'Maximize is replaced by Restore').toBeVisible();
    await expect(maximize(page), 'Maximize is no longer offered').toHaveCount(0);

    await restore(page).click();
    await expect(composer(page), 'Restore drops the full-screen class').not.toHaveClass(
      /fullscreen_back_color/,
      { timeout: 10_000 },
    );
    await expect(maximize(page), 'Maximize is offered again').toBeVisible();
  });

  test('FR-KU-005 — Clear discards a typed Subject and body, and the composer stays usable @ui', async ({
    page,
  }) => {
    await openComposer(page);
    const subject = page.getByRole('textbox', { name: 'Subject' });
    await expect(subject, 'the Subject field is up').toBeVisible({ timeout: 15_000 });

    await subject.fill('QA discard subject');
    await page.locator(EDITOR).first().click();
    await page.keyboard.type('QA discard body — must not survive Clear');
    await expect(subject).toHaveValue('QA discard subject');
    await expect(page.locator(EDITOR).first()).toContainText('must not survive Clear');

    await clear(page).click();

    await expect(subject, 'Clear empties the Subject').toHaveValue('', { timeout: 10_000 });
    await expect(page.locator(EDITOR).first(), 'Clear empties the message body').not.toContainText(
      'must not survive Clear',
    );
    // Still a working composer afterwards — not torn down or wedged.
    await expect(subject, 'the Subject field remains editable').toBeEditable();
    await subject.fill('still works');
    await expect(subject).toHaveValue('still works');
  });

  test('FR-KU-006 — Formatting reveals the Quill toolbar and Bold / Italic apply to typed text @ui', async ({
    page,
  }) => {
    await openComposer(page);
    await expect(formatting(page), 'the composer offers Formatting').toBeVisible({
      timeout: 15_000,
    });

    const toolbar = composer(page).locator('.ql-toolbar').first();
    await formatting(page).click();
    await expect(toolbar, 'the Formatting toggle shows the Quill toolbar').toBeVisible({
      timeout: 10_000,
    });
    // The toolbar the source configures: the essentials must be there.
    for (const [sel, label] of [
      ['.ql-bold', 'Bold'],
      ['.ql-italic', 'Italic'],
      ['.ql-underline', 'Underline'],
      ['.ql-list', 'List'],
      ['.ql-link', 'Link'],
    ] as const) {
      await expect(toolbar.locator(sel).first(), `${label} is in the toolbar`).toBeVisible();
    }

    const editor = page.locator(EDITOR).first();
    await editor.click();
    await toolbar.locator('.ql-bold').first().click();
    await page.keyboard.type('bold text');
    await toolbar.locator('.ql-bold').first().click();
    await toolbar.locator('.ql-italic').first().click();
    await page.keyboard.type(' italic text');

    await expect(
      editor.locator('strong, b').filter({ hasText: 'bold text' }).first(),
      'Bold wraps the typed text in a strong element',
    ).toBeVisible();
    await expect(
      editor.locator('em, i').filter({ hasText: 'italic text' }).first(),
      'Italic wraps the typed text in an em element',
    ).toBeVisible();

    // Observed live 2026-10-10, recorded not asserted: a second click on Formatting leaves the
    // toolbar showing (the handler re-forces full-screen on every click). FR-KU-006 asks for
    // formatting, not for a hide toggle, so this is an annotation for the owner, not a failure.
    await formatting(page).click();
    const stillShown = await toolbar.isVisible().catch(() => false);
    test.info().annotations.push({
      type: 'observed',
      description: `after a second Formatting click the toolbar is ${stillShown ? 'still shown' : 'hidden'}`,
    });
  });
});
