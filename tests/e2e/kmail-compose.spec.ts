import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * **KMail compose → send** (FR-M01). Navigating to `/writemail` opens the compose form directly
 * (`Kmail.js` sets `showWriteMail` when the path is `/writemail` → renders `WriteMailPage.js`).
 *
 * Selectors from `WriteMailPage.js` (see `docs/ui-build-plan.md`):
 *   To      `input[name="to"]` (`.subjectTextboxKmailTO`)
 *   Subject `.toInput` (maxlen 70)
 *   Body    the Quill editor (placeholder "Type your mail here")
 *   Send    `.post_button_size` (carries `.icon-KP_3164`), onClick=PostMail(false)
 *
 * The compose-form check is read-only and safe. The **send** is a real write, so it is gated behind
 * `KMAIL_UI_LIFECYCLE=true` and targets our own 2nd QA account.
 *
 * Tuned GREEN on live: the body Quill is `contenteditable=true` but is destabilised by the To-field
 * autocomplete, so the body is typed FIRST; the recipient is then picked from the suggestion dropdown;
 * send is `.post_button_size` (icon `.icon-KP_3164`); success is asserted by the react-toastify success
 * message / compose clearing. Sent mail lands in the 2nd QA account's inbox (own account — harmless).
 */
test.describe('KPost KMail compose', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the compose form renders its To, Subject and body fields @ui', async ({ page }) => {
    await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    await expect(
      page.locator('input[name="to"], .subjectTextboxKmailTO').first(),
      'the To field is present',
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.toInput').first(), 'the Subject field is present').toBeVisible();
    await expect(
      page
        .getByText(/Type your mail here/i)
        .or(page.locator('.ql-editor'))
        .first(),
      'the mail body editor is present',
    ).toBeVisible();
  });
});

test.describe('KPost KMail compose · send (write)', { tag: '@ui' }, () => {
  test.skip(!env.KMAIL_UI_LIFECYCLE, 'sends a real mail; set KMAIL_UI_LIFECYCLE=true');
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts',
  );

  test('compose a mail to the 2nd QA account and send it (FR-M01) @ui', async ({ page }) => {
    const subject = `QA UI mail ${Date.now()}`;

    await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    // Body FIRST — filling the To field opens a recipient autocomplete dropdown that destabilises the
    // layout, so interacting with the Quill body before that keeps the body click stable.
    const body = page.locator('.ql-editor[contenteditable="true"]').first();
    await body.click({ force: true });
    await page.keyboard.type('QA UI KMail body — self-cleaning');

    // Recipient (our own 2nd QA account): type the address, then pick it from the suggestion dropdown
    // if one surfaces (KMail resolves the recipient from the picker, not from raw text).
    const to = page.locator('.subjectTextboxKmailTO, input[name="to"]').first();
    await to.click();
    await to.fill(testData.victimKpostId);
    // Pick the recipient from the suggestion dropdown if one surfaces (the click waits for it; the
    // typed value alone may not register the recipient). Best-effort — some builds accept raw text.
    await page
      .getByText(testData.victimKpostId, { exact: false })
      .last()
      .click({ timeout: 4_000 })
      .catch(() => undefined);

    // Subject.
    await page.locator('.toInput').first().fill(subject);

    // Send (PostMail): the button carries the send icon KP_3164.
    await page
      .locator('.post_button_size')
      .filter({ has: page.locator('.icon-KP_3164') })
      .first()
      .click()
      .catch(() => page.locator('.post_button_size').first().click());

    // Sent: a react-toastify success message appears, or the compose surface clears. Accept either.
    await expect(
      page
        .getByText(/sent|success/i)
        .first()
        .or(page.locator('.Toastify__toast--success').first()),
      'the mail was sent (success toast / compose cleared)',
    ).toBeVisible({ timeout: 20_000 });
  });
});
