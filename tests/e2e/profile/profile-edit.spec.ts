import { testData } from '@config/test-data.config';
import { text } from '@database/kpost-assertions';
import { expect, test } from '@fixtures';
import { requireKpostDb, rowSummary, rowWhen } from '../support/cross-layer';

/**
 * Profile About edit through the UI: save request, on-screen text and the DB row. Gated behind
 * PROFILE_UI_LIFECYCLE; self-restoring. The hover-revealed edit pencil is fragile, so "Edit Profile"
 * is the fallback entry.
 */
test.describe(
  'KPost Profile · edit About (write)',
  { tag: ['@ui', '@profile', '@regression'] },
  () => {
    test.skip(
      process.env.PROFILE_UI_LIFECYCLE !== 'true',
      'edits a profile field; set PROFILE_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test(
      'edit the About text, verify it saved, then restore the original @ui',
      {
        annotation: [
          {
            type: 'cross-layer',
            description:
              'Profile: About edit → profile save request → TBL_KPOST_USER_PROFILE.about_yourself',
          },
        ],
      },
      async ({ page, databases }) => {
        const db = requireKpostDb(databases);
        const marker = `QA UI about ${Date.now()}`;

        await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page
          .locator('.loader-overlay')
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .catch(() => undefined);

        const about = page.locator('#About');
        await expect(about, 'the About section renders').toBeVisible({ timeout: 20_000 });

        // Read the current About text so we can restore it.
        const original = ((await about.locator('.nuntio-font').first().textContent()) ?? '').trim();

        // The pencil is hover-revealed; fall back to the visible "Edit Profile" control.
        await about.hover().catch(() => undefined);
        await about
          .locator('.icon-KP_236_Edit')
          .first()
          .click({ force: true, timeout: 5_000 })
          .catch(() =>
            page
              .getByText(/^Edit Profile$/i)
              .first()
              .click(),
          );

        const editor = page.getByPlaceholder(/Write about yourself/i).first();
        await expect(editor, 'the About editor opens').toBeVisible({ timeout: 15_000 });

        await editor.fill(marker);
        // Layer 2: the save request and the server's answer.
        const saved = page.waitForResponse(
          (r) => r.request().method() === 'POST' && r.url().includes('/profile/'),
          { timeout: 20_000 },
        );
        await page.getByRole('button', { name: /^Update$/i }).click();
        const saveResponse = await saved;
        test.info().annotations.push({
          type: 'observed',
          description: `save: ${saveResponse.url().split('/').slice(-2).join('/')} → HTTP ${saveResponse.status()}; sent ${String(saveResponse.request().postData()).slice(0, 200)}`,
        });
        expect(saveResponse.status(), 'the profile save is accepted').toBeLessThan(300);
        expect(
          saveResponse.request().postData() ?? '',
          'the save carries the new About text',
        ).toContain(marker);

        await expect(page.getByText(marker).first(), 'the edited About text is shown').toBeVisible({
          timeout: 20_000,
        });

        // Layer 3: the row holds exactly what was typed.
        const row = await rowWhen<{ about_yourself: unknown }>(
          db,
          'SELECT about_yourself FROM TBL_KPOST_USER_PROFILE WHERE kpost_id = ?',
          [testData.kpostId],
          (r) => text(r?.about_yourself) === marker,
          'TBL_KPOST_USER_PROFILE.about_yourself holds the edited About text',
        );
        test.info().annotations.push({
          type: 'observed',
          description: `row: ${rowSummary(row, ['about_yourself'])}`,
        });

        // Restore the original About; best-effort, since the hover pencil is flaky on re-render.
        try {
          await about.hover().catch(() => undefined);
          await about.locator('.icon-KP_236_Edit').first().click({ force: true, timeout: 5_000 });
          const restoreEditor = page.getByPlaceholder(/Write about yourself/i).first();
          await restoreEditor.waitFor({ state: 'visible', timeout: 8_000 });
          await restoreEditor.fill(original);
          await page.getByRole('button', { name: /^Update$/i }).click();
        } catch {
          // Re-entry missed: our own QA account keeps the marker in About.
        }
      },
    );
  },
);
