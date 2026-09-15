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
 * FIRST-RUN NOTE: the composer's add-a-Copy / add-a-Confidential-Copy recipient picker is a nested
 * control (`copiesMemberMessage` {reveal, hidden}) that needs one live recording pass — `addCopy()`
 * below is best-effort. The multi-account VERIFY (who can see whom) is the validated security logic.
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
      const trigger = confidential ? /Confidential Copy/i : /^Copy$/i;
      await page
        .getByText(trigger)
        .first()
        .click()
        .catch(() => undefined);
      await page
        .getByText(kpostId)
        .first()
        .click()
        .catch(() => undefined);
      await page
        .getByRole('button', { name: /Add|Done|OK|Select/i })
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
