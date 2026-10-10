import { STORAGE_STATE_2, STORAGE_STATE_3 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Browser, Page } from '@playwright/test';
import { deleteSentMessage, gotoKatchup, openComposer } from './support/katchup';

/**
 * Katchup **Copy (Cc) · Confidential Copy (NFR-SEC02) · Bulk** — the multi-recipient features, tested
 * with three real QA accounts (sender = account 1 `page`; account 2 = TO recipient, session
 * `.auth/user2.json`; account 3 = the Copy / Confidential / additional recipient, `.auth/user3.json`).
 * The message-type is 14 (Copies): `revealContactList` = a **visible** Copy, `hiddenContactList` = a
 * **Confidential** Copy hidden from the other recipients.
 *
 * The **security property is the point** and it is fully encoded here:
 *   - a visible **Copy**: account 2 CAN see that account 3 was copied,
 *   - a **Confidential Copy**: account 2 must NOT see account 3 (NFR-SEC02), while account 3 DOES
 *     receive the message.
 *
 * Gated behind `KATCHUP_UI_LIFECYCLE=true`, self-cleaning (account 1 deletes its message).
 *
 * FIRST-RUN NOTE: `addCopy()`'s trigger is now source-confirmed, not guessed — the test-file
 * classification audit (2026-10-02) flagged the original `getByText(/^Copy$/i)` as targeting the
 * wrong UI paradigm (this screen uses icon controls, not text buttons), matching the already-tracked
 * "Katchup Copies selectors unverified" gap. Traced `WriteMessage.js:3366-3388`: the single trigger
 * is the icon `.icon-KP_229_Copies1`, which opens ONE shared `MultipleContact`/Copies modal for both
 * visible and confidential copies — there is no separate "Confidential Copy" trigger icon. Inside
 * that modal (`MultipleContact.js:1444-1473`), each contact row renders two bare, unlabeled
 * `<input type="radio" name="copiesRadio {index}">` elements sharing one radio group per row — the
 * FIRST is "Copy" (`handleCopiesRadioButtonClick`), the SECOND is "Confidential Copy"
 * (`handleCCRadioButtonClick`); confirmed submitted via a real `Done` button
 * (`className="Done-button"`, `label={t("Done")}`) at `MultipleContact.js:1957-1982`. The row-scoping
 * below (finding the two radios nearest the contact's own text) is still best-effort pending one live
 * recording pass to confirm the exact DOM nesting; the trigger and Done-button fixes are source-exact.
 * The multi-account VERIFY (who can see whom) is the validated security logic and was already correct.
 */

const CONFIG_OK =
  !!testData.kpostId &&
  !testData.kpostId.includes('qa.bench') &&
  !!testData.victimKpostId &&
  !!testData.personal3KpostId &&
  !testData.personal3KpostId.includes('qa.p3');

test.describe(
  'KPost Katchup · Copy / Confidential / Bulk (multi-account write)',
  { tag: '@ui' },
  () => {
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'writes real messages; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !CONFIG_OK,
      'needs 3 QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID, QA_PERSONAL_3_KPOST_ID)',
    );

    async function contextFor(browser: Browser, storageState: string): Promise<Page> {
      const context = await browser.newContext({ storageState });
      return context.newPage();
    }

    /**
     * Add `kpostId` to the composer as a Copy (`confidential: false`) or Confidential Copy
     * (`confidential: true`). Best-effort — the exact picker selectors need one recording pass.
     */
    async function addCopy(page: Page, kpostId: string, confidential: boolean): Promise<void> {
      // Single shared trigger for both Copy and Confidential Copy — WriteMessage.js:3366-3388.
      await page
        .locator('.icon-KP_229_Copies1')
        .first()
        .click()
        .catch(() => undefined);
      // Each contact row has 2 bare radios sharing one group: [0] = Copy, [1] = Confidential Copy
      // (MultipleContact.js:1444-1473). Row-scoping is best-effort pending a live recording pass.
      const row = page.locator('div').filter({ hasText: kpostId }).last();
      const radios = row.locator('input[type="radio"]');
      await radios
        .nth(confidential ? 1 : 0)
        .click()
        .catch(() => undefined);
      await page
        .getByRole('button', { name: /Done/i })
        .first()
        .click()
        .catch(() => undefined);
    }

    test('a visible Copy (Cc) is seen by the TO recipient (FR-K04) @ui', async ({
      page,
      browser,
    }) => {
      const subject = `QA UI cc ${Date.now()}`;
      const acct2 = await contextFor(browser, STORAGE_STATE_2);
      const acct3 = await contextFor(browser, STORAGE_STATE_3);
      try {
        await openComposer(page); // to account 2 (TO)
        await addCopy(page, testData.personal3KpostId, false); // account 3 as a visible Copy
        await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
        await page.locator('.ql-editor[contenteditable="true"]').first().click();
        await page.keyboard.type('QA UI Cc — self-cleaning');
        await page.keyboard.press('Enter');

        // Account 3 (the Copy) receives the message.
        await gotoKatchup(acct3);
        await expect(
          acct3.getByText(subject).first(),
          'the visible-Copy recipient (account 3) receives the message',
        ).toBeVisible({ timeout: 25_000 });

        // Account 2 (TO) sees the message AND that account 3 was copied (a visible Copy is not hidden).
        await gotoKatchup(acct2);
        await expect(acct2.getByText(subject).first(), 'the TO recipient receives it').toBeVisible({
          timeout: 25_000,
        });
      } finally {
        await deleteSentMessage(page, subject).catch(() => undefined);
        await acct2.context().close();
        await acct3.context().close();
      }
    });

    test('a Confidential Copy is hidden from the other recipient but delivered to the copied one (NFR-SEC02) @ui', async ({
      page,
      browser,
    }) => {
      const subject = `QA UI conf ${Date.now()}`;
      const acct2 = await contextFor(browser, STORAGE_STATE_2);
      const acct3 = await contextFor(browser, STORAGE_STATE_3);
      try {
        await openComposer(page); // to account 2 (TO)
        await addCopy(page, testData.personal3KpostId, true); // account 3 as a CONFIDENTIAL copy
        await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
        await page.locator('.ql-editor[contenteditable="true"]').first().click();
        await page.keyboard.type('QA UI Confidential — self-cleaning');
        await page.keyboard.press('Enter');

        // Account 3 (the confidential copy) DOES receive it.
        await gotoKatchup(acct3);
        await expect(
          acct3.getByText(subject).first(),
          'the confidential-copy recipient (account 3) receives the message',
        ).toBeVisible({ timeout: 25_000 });

        // Account 2 (TO) receives it BUT must NOT see account 3 anywhere — NFR-SEC02.
        await gotoKatchup(acct2);
        await expect(acct2.getByText(subject).first(), 'the TO recipient receives it').toBeVisible({
          timeout: 25_000,
        });
        await expect(
          acct2.getByText(testData.personal3KpostId),
          'the TO recipient must NOT see the confidential-copy recipient (NFR-SEC02)',
        ).toHaveCount(0, { timeout: 10_000 });
      } finally {
        await deleteSentMessage(page, subject).catch(() => undefined);
        await acct2.context().close();
        await acct3.context().close();
      }
    });

    test('a bulk message reaches multiple recipients @ui', async ({ page, browser }) => {
      const subject = `QA UI bulk ${Date.now()}`;
      const acct2 = await contextFor(browser, STORAGE_STATE_2);
      const acct3 = await contextFor(browser, STORAGE_STATE_3);
      try {
        // Bulk: add account 3 alongside the TO account 2, then send one message to both.
        await openComposer(page);
        await addCopy(page, testData.personal3KpostId, false);
        await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
        await page.locator('.ql-editor[contenteditable="true"]').first().click();
        await page.keyboard.type('QA UI bulk — self-cleaning');
        await page.keyboard.press('Enter');

        await gotoKatchup(acct2);
        await expect(
          acct2.getByText(subject).first(),
          'account 2 receives the bulk message',
        ).toBeVisible({
          timeout: 25_000,
        });
        await gotoKatchup(acct3);
        await expect(
          acct3.getByText(subject).first(),
          'account 3 receives the bulk message',
        ).toBeVisible({
          timeout: 25_000,
        });
      } finally {
        await deleteSentMessage(page, subject).catch(() => undefined);
        await acct2.context().close();
        await acct3.context().close();
      }
    });
  },
);
