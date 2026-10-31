import { STORAGE_STATE_2, STORAGE_STATE_3 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import type { Browser, Page } from '@playwright/test';
import { deleteSentMessage, gotoKatchup, openComposer, openConversation } from '../support/katchup';
import { signedIn } from '@fixtures/login-gate';

/**
 * Katchup Copy, Confidential Copy (NFR-SEC02) and Bulk across three QA accounts (1 sends, 2 is TO,
 * 3 is copied). A Confidential Copy must reach account 3 but stay hidden from account 2.
 * Gated behind KATCHUP_UI_LIFECYCLE; account 1 deletes its message afterwards.
 */

const CONFIG_OK =
  !!testData.kpostId &&
  !testData.kpostId.includes('qa.bench') &&
  !!testData.victimKpostId &&
  !!testData.personal3KpostId &&
  !testData.personal3KpostId.includes('qa.p3');

test.describe(
  'KPost Katchup · Copy / Confidential / Bulk (multi-account write)',
  { tag: ['@ui', '@katchup', '@regression'] },
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
      const context = await browser.newContext({ storageState: signedIn(storageState) });
      return context.newPage();
    }

    /**
     * Add `kpostId` to the composer as a Copy (`confidential: false`) or Confidential Copy
     * (`confidential: true`). Best-effort — the exact picker selectors need one recording pass.
     */
    async function addCopy(page: Page, kpostId: string, confidential: boolean): Promise<void> {
      // One shared trigger icon for both Copy and Confidential Copy.
      await page
        .locator('.icon-KP_229_Copies1')
        .first()
        .click()
        .catch(() => undefined);
      // Each row has two unlabeled radios: [0] = Copy, [1] = Confidential Copy. Row scoping is best-effort.
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

    /**
     * Reads reveal/hidden copies from the send request (call BEFORE pressing Enter), proving which
     * kind of copy `addCopy` really chose.
     */
    function captureCopies(page: Page, subject: string) {
      return page
        .waitForRequest(
          (r) =>
            r.method() === 'POST' &&
            /katchup/i.test(r.url()) &&
            (r.postData() ?? '').includes(subject),
          { timeout: 20_000 },
        )
        .then((r) => {
          const body = JSON.parse(r.postData() ?? '{}') as { sharedMessageDetails?: string };
          const details = JSON.parse(body.sharedMessageDetails ?? '{}') as {
            revealContactList?: string[];
            hiddenContactList?: string[];
          };
          return {
            reveal: details.revealContactList ?? [],
            hidden: details.hiddenContactList ?? [],
          };
        });
    }

    /** The display name the app shows for an account (fetchUserDetails first + last name). */
    async function displayName(endpoints: EndpointExecutor, kpostId: string): Promise<string> {
      const ex = await endpoints.sendTo(
        'signup-login-fetch-user-details',
        { body: { kpostID: kpostId, countryID: testData.countryId } },
        { label: 'copies:name' },
      );
      const parsed = ex.json();
      const d = ((parsed.ok ? (parsed.value as { data?: unknown }).data : {}) ?? {}) as {
        firstName?: string;
        lastName?: string;
      };
      return `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim();
    }

    /** The TO recipient's "Message With Copies" dialog text; '' when the message has no Copies icon. */
    async function copiesShownTo(page: Page, subject: string): Promise<string> {
      await openConversation(page, testData.kpostId);
      const message = page.locator('[id]').filter({ hasText: subject }).last();
      await expect(message, 'the TO recipient has the message in the conversation').toBeVisible({
        timeout: 25_000,
      });
      const icon = message.locator('.icon-KP_229_Copies1').first();
      if (!(await icon.count())) return '';
      await icon.click();
      const dialog = page
        .getByRole('dialog')
        .filter({ hasText: /Message With Copies/i })
        .last();
      await expect(dialog, 'the copies dialog opens').toBeVisible({ timeout: 15_000 });
      return dialog.innerText();
    }

    test(
      'a visible Copy is delivered, and the TO recipient is shown who was copied (FR-KU-007) @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-007' }] },
      async ({ page, browser, endpoints }) => {
        const subject = `QA UI cc ${Date.now()}`;
        const acct2 = await contextFor(browser, STORAGE_STATE_2);
        const acct3 = await contextFor(browser, STORAGE_STATE_3);
        try {
          const copyName = await displayName(endpoints, testData.personal3KpostId);
          await openComposer(page); // to account 2 (TO)
          await addCopy(page, testData.personal3KpostId, false); // account 3 as a visible Copy
          await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
          await page.locator('.ql-editor[contenteditable="true"]').first().click();
          await page.keyboard.type('QA UI Cc — self-cleaning');
          const sent = captureCopies(page, subject);
          await page.keyboard.press('Enter');
          const copies = await sent;
          expect(copies.reveal, 'the composer sent account 3 as a visible Copy').toContain(
            testData.personal3KpostId,
          );

          // Account 3 (the Copy) receives the message.
          await gotoKatchup(acct3);
          await expect(
            acct3.getByText(subject).first(),
            'the visible-Copy recipient (account 3) receives the message',
          ).toBeVisible({ timeout: 25_000 });

          // Account 2 (TO) is shown that account 3 was copied — a visible Copy is not hidden.
          const shown = await copiesShownTo(acct2, subject);
          test.info().annotations.push({
            type: 'observed',
            description: `TO sees: ${shown.replace(/\s+/g, ' ').slice(0, 200)}`,
          });
          expect(
            shown,
            `the TO recipient's "Message With Copies" lists the Copy, ${copyName}`,
          ).toContain(copyName);
        } finally {
          await deleteSentMessage(page, subject).catch(() => undefined);
          await acct2.context().close();
          await acct3.context().close();
        }
      },
    );

    test(
      'a Confidential Copy is hidden from the other recipient but delivered to the copied one (NFR-SEC02) @ui',
      {
        annotation: [
          { type: 'requirement', description: 'FR-KU-007' },
          { type: 'requirement', description: 'NFR-SEC02' },
        ],
      },
      async ({ page, browser, endpoints }) => {
        const subject = `QA UI conf ${Date.now()}`;
        const acct2 = await contextFor(browser, STORAGE_STATE_2);
        const acct3 = await contextFor(browser, STORAGE_STATE_3);
        try {
          const copyName = await displayName(endpoints, testData.personal3KpostId);
          await openComposer(page); // to account 2 (TO)
          await addCopy(page, testData.personal3KpostId, true); // account 3 as a CONFIDENTIAL copy
          await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
          await page.locator('.ql-editor[contenteditable="true"]').first().click();
          await page.keyboard.type('QA UI Confidential — self-cleaning');
          const sent = captureCopies(page, subject);
          await page.keyboard.press('Enter');
          const copies = await sent;
          expect(copies.hidden, 'the composer sent account 3 as a Confidential Copy').toContain(
            testData.personal3KpostId,
          );
          expect(copies.reveal, 'and not as a visible Copy').not.toContain(
            testData.personal3KpostId,
          );

          // Account 3 (the confidential copy) DOES receive it.
          await gotoKatchup(acct3);
          await expect(
            acct3.getByText(subject).first(),
            'the confidential-copy recipient (account 3) receives the message',
          ).toBeVisible({ timeout: 25_000 });

          // Account 2 (TO) receives it BUT is never shown account 3 — not by id, not by name (NFR-SEC02).
          const shown = await copiesShownTo(acct2, subject);
          test.info().annotations.push({
            type: 'observed',
            description: `TO sees: ${shown.replace(/\s+/g, ' ').slice(0, 200)}`,
          });
          expect(
            shown,
            `the TO recipient's copies dialog must not name the confidential copy, ${copyName}`,
          ).not.toContain(copyName);
          await expect(
            acct2.getByText(testData.personal3KpostId),
            'nor show their id anywhere on the screen',
          ).toHaveCount(0, { timeout: 10_000 });
        } finally {
          await deleteSentMessage(page, subject).catch(() => undefined);
          await acct2.context().close();
          await acct3.context().close();
        }
      },
    );

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
