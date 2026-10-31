import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { EDITOR, openComposer } from '../support/katchup';

/**
 * Katchup composer controls: Maximize/Restore (FR-KU-004), Clear (FR-KU-005), Formatting toolbar
 * with Bold/Italic (FR-KU-006). Nothing is sent; every test ends on Clear.
 */
test.describe(
  'KPost Katchup · composer controls (FR-KU-004/005/006)',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );
    test.skip(
      !testData.victimKpostId || testData.victimKpostId.includes('qa.victim'),
      'needs the 2nd QA account (QA_VICTIM_KPOST_ID) to open a conversation with',
    );

    // Scoped to the composer root: other Quill instances on the page share the `ql-*` classes.
    const composer = (page: Page) => page.locator('.writeMsg_mainDiv').first();
    const maximize = (page: Page) =>
      composer(page).locator('.icon-KP_313[title="Maximize"]').first();
    const restore = (page: Page) =>
      composer(page).locator('.icon-KP_312_Minimize[title="Restore"]').first();
    const clear = (page: Page) =>
      composer(page).locator('.icon-KP_29-Delete[title="Clear"]').first();
    const formatting = (page: Page) =>
      composer(page).locator('.icon-KP_98-Font-Style[title="Formatting"]').first();

    test.afterEach(async ({ page }) => {
      // Leave the composer empty whatever the test did (Clear is idempotent; ignore if already gone).
      await clear(page)
        .click({ timeout: 3_000 })
        .catch(() => undefined);
    });

    test(
      'FR-KU-004 — Maximize puts the composer full-screen and Restore brings it back @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-004' }] },
      async ({ page }) => {
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
      },
    );

    test(
      'FR-KU-005 — Clear discards a typed Subject and body, and the composer stays usable @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-005' }] },
      async ({ page }) => {
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
        await expect(
          page.locator(EDITOR).first(),
          'Clear empties the message body',
        ).not.toContainText('must not survive Clear');
        // Still a working composer afterwards — not torn down or wedged.
        await expect(subject, 'the Subject field remains editable').toBeEditable();
        await subject.fill('still works');
        await expect(subject).toHaveValue('still works');
      },
    );

    test(
      'FR-KU-006 — Formatting reveals the Quill toolbar and Bold / Italic apply to typed text @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-006' }] },
      async ({ page }) => {
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

        // Recorded, not asserted: FR-KU-006 asks for formatting, not a hide toggle.
        await formatting(page).click();
        const stillShown = await toolbar.isVisible().catch(() => false);
        test.info().annotations.push({
          type: 'observed',
          description: `after a second Formatting click the toolbar is ${stillShown ? 'still shown' : 'hidden'}`,
        });
      },
    );
  },
);
