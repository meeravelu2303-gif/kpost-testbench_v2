import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Profile **edit** through the UI — the About section, the cleanest self-restoring profile write and
 * the UI analogue of the green API `updateAbout` lifecycle. Own account, own data.
 *
 * Selectors from `components/UserProfile/UserProfile.js`: the About section is `#About` with a scoped
 * edit pencil `.icon-KP_236_Edit` (self-profile only), which opens an editor whose field carries the
 * placeholder "Write about yourself..." (`Settings/About`) and a save button labelled "Update".
 *
 * Gated behind `PROFILE_UI_LIFECYCLE=true` (it writes a profile field) and **self-restoring** — it
 * reads the current About first and puts it back, so the account ends unchanged.
 *
 * FIRST-RUN NOTE: not yet tuned on live; the About editor's exact surface (inline vs modal) needs one
 * recording pass. Never runs on a default run, so it cannot file a false bug. Remove this after tuning.
 */
test.describe('KPost Profile · edit About (write)', { tag: '@ui' }, () => {
  test.skip(
    process.env.PROFILE_UI_LIFECYCLE !== 'true',
    'edits a profile field; set PROFILE_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('edit the About text, verify it saved, then restore the original @ui', async ({ page }) => {
    const marker = `QA UI about ${Date.now()}`;

    await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    const about = page.locator('#About');
    await expect(about, 'the About section renders').toBeVisible({ timeout: 20_000 });

    // Read the current About text so we can restore it (a genuine value read, not an assertion).
    const original = ((await about.locator('.nuntio-font').first().textContent()) ?? '').trim();

    // Open the About editor via its scoped edit pencil.
    await about.locator('.icon-KP_236_Edit').first().click();

    const editor = page.getByPlaceholder(/Write about yourself/i).first();
    await expect(editor, 'the About editor opens').toBeVisible({ timeout: 15_000 });

    // Replace the text and save.
    await editor.fill(marker);
    await page.getByRole('button', { name: /^Update$/i }).click();

    // The new About surfaces on the profile (best-effort — the read-back can lag eventual consistency).
    await expect(page.getByText(marker).first(), 'the edited About text is shown').toBeVisible({
      timeout: 20_000,
    });

    // Restore the original About so the account ends as it started.
    await about.locator('.icon-KP_236_Edit').first().click();
    const restoreEditor = page.getByPlaceholder(/Write about yourself/i).first();
    await expect(restoreEditor, 'the About editor reopens for restore').toBeVisible({
      timeout: 15_000,
    });
    await restoreEditor.fill(original);
    await page.getByRole('button', { name: /^Update$/i }).click();
  });
});
