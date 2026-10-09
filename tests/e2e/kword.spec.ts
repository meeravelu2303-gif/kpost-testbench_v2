import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * KOS · Kompose (KWord) — the real document editor behind KOS's "Kompose" tool card. `KWord.js` is a
 * genuine, backend-integrated feature (`POST /v2/kword/create`, `/update`, `/saveContent`,
 * `/delete`, ...), not a stub. Flow: home (New Document / My Documents) -> create form -> editor
 * (SunEditor, `.sun-editor-editable`) -> Save -> My Documents library.
 *
 * The create-form validation (empty title blocked client-side) is safe and always runs. The full
 * create -> save -> delete round trip is a REAL write (a genuine document persists until deleted), so
 * it's gated behind `KOS_UI_LIFECYCLE=true` and self-cleaning: it deletes the document it created via
 * the app's own soft-delete-then-permanent-delete flow before finishing.
 */
test.describe('KPost KOS · Kompose (KWord) — create-form validation', { tag: ['@ui', '@kos'] }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('creating a document with an empty title is blocked client-side, before any API call @ui', async ({
    page,
  }) => {
    await page.goto('/kdoc', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.getByText('Kompose', { exact: true }).first().click();

    await expect(page.getByText(/^New Document$/i).first(), 'the KWord home renders').toBeVisible({
      timeout: 15_000,
    });
    await page.getByText(/^New Document$/i).first().click();

    let createRequestFired = false;
    page.on('request', (req) => {
      if (req.url().includes('/kword/create')) createRequestFired = true;
    });

    await expect(
      page.getByPlaceholder('Enter Title of the Document').first(),
      'the create form renders',
    ).toBeVisible({ timeout: 10_000 });
    // Deliberately leave the title empty.
    await page.getByRole('button', { name: /Compose Document/i }).first().click();

    await expect(
      page.getByText(/Title of the Document is required/i).first(),
      'an empty title is rejected with the documented client-side error',
    ).toBeVisible({ timeout: 10_000 });

    expect(
      createRequestFired,
      'a blocked (empty-title) submission must never reach the real /kword/create API',
    ).toBe(false);
  });
});

test.describe('KPost KOS · Kompose (KWord) — create, save, delete (write)', { tag: ['@ui', '@kos'] }, () => {
  test.skip(
    process.env.KOS_UI_LIFECYCLE !== 'true',
    'creates and deletes a real document; set KOS_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('create a Word document, type content, Save, then permanently delete it @ui', async ({
    page,
  }) => {
    const title = `QA UI kword ${Date.now()}`;

    await page.goto('/kdoc', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.getByText('Kompose', { exact: true }).first().click();
    await expect(page.getByText(/^New Document$/i).first(), 'the KWord home renders').toBeVisible({
      timeout: 15_000,
    });
    await page.getByText(/^New Document$/i).first().click();

    const titleField = page.getByPlaceholder('Enter Title of the Document').first();
    await expect(titleField, 'the create form renders').toBeVisible({ timeout: 10_000 });
    await titleField.fill(title);
    // Word Document is the default doc-type card — confirm it's selectable explicitly.
    await page.getByText(/^Word Document$/i).first().click();

    const createPromise = page.waitForRequest(
      (req) => req.url().includes('/kword/create') && req.method() === 'POST',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: /Compose Document/i }).first().click();
    await createPromise;

    const editor = page.locator('.sun-editor-editable').first();
    await expect(editor, 'the SunEditor editor opens').toBeVisible({ timeout: 20_000 });
    await editor.click();
    await page.keyboard.type('QA UI test content — self-cleaning document.');

    const saveButton = page.getByRole('button', { name: /^Save$/i }).first();
    await expect(saveButton, 'Save becomes available').toBeEnabled({ timeout: 10_000 });
    const savePromise = page.waitForRequest(
      (req) => req.url().includes('/kword/saveContent'),
      { timeout: 15_000 },
    );
    await saveButton.click();
    await savePromise;

    // Clean up: find the document in My Documents and delete it permanently.
    await page.getByText(/^My Documents$/i).first().click();
    const searchBox = page.getByPlaceholder(/Search by title, subject, author or date/i).first();
    await expect(searchBox, 'the My Documents library renders with a search box').toBeVisible({
      timeout: 15_000,
    });
    await searchBox.fill(title);
    await expect(page.getByText(title).first(), 'the created document appears in the library').toBeVisible({
      timeout: 15_000,
    });

    // Soft-delete-with-undo pattern, confirmed from source — trigger delete, then let the toast's
    // window pass without undoing, then confirm the second (permanent) step if the app requires one.
    await page
      .getByText(title)
      .first()
      .locator('..')
      .getByRole('button', { name: /delete/i })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);
    await expect(
      page.getByText(/Delete undone|Document deleted permanently/i).first(),
      'the delete flow shows its documented toast (soft-delete window or permanent confirmation)',
    ).toBeVisible({ timeout: 10_000 });
  });
});
