import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { EDITOR, gotoKatchup, parkPointerAwayFromSideMenu } from '../support/katchup';
import { settleFrames } from '../support/settle';

/**
 * Katchup draft: a half-typed message survives switching conversations and back within the session
 * (drafts are client-side state only, so no reload). Switches by in-SPA row clicks, never
 * `openConversation`, which navigates and resets the draft. Sends nothing.
 */
const SECOND_CONTACT_ID = 'qatest3@kpostindia.com';

test.describe(
  'KPost Katchup · draft persistence (in-session)',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'types into a real composer; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
    );

    test('a half-typed message survives switching conversations and back (no reload) @ui', async ({
      page,
    }) => {
      const draftSubject = `QA draft ${Date.now()}`;
      const draftBody = `QA draft body ${Date.now()} — should survive a conversation switch`;

      // One load; every switch after this is an in-SPA row click.
      await gotoKatchup(page);
      await parkPointerAwayFromSideMenu(page);

      // Open conversation A (the 2nd QA account) and its composer, then type a draft WITHOUT sending.
      const rowA = page
        .locator(`[id="${testData.victimKpostId}"], [id^="${testData.victimKpostId}-"]`)
        .first();
      await expect(rowA, 'conversation A is in the list').toBeVisible({ timeout: 20_000 });
      await rowA.click();
      await page.locator('.msg-arrow').first().click();
      await page.getByRole('textbox', { name: 'Subject' }).fill(draftSubject);
      await page.locator(EDITOR).first().click();
      await page.keyboard.type(draftBody);
      await settleFrames(page).catch(() => undefined);

      // Switch to conversation B (a different contact) in-SPA, then back to A.
      await parkPointerAwayFromSideMenu(page);
      const rowB = page
        .locator(`[id="${SECOND_CONTACT_ID}"], [id^="${SECOND_CONTACT_ID}-"]`)
        .first();
      test.skip(
        (await rowB.count()) === 0,
        `the second contact (${SECOND_CONTACT_ID}) is not in this account's Recents right now — nothing to switch to`,
      );
      await rowB.click();
      await settleFrames(page).catch(() => undefined);
      await parkPointerAwayFromSideMenu(page);
      await rowA.click();
      await page.locator('.msg-arrow').first().click();
      await settleFrames(page).catch(() => undefined);

      await expect(
        page.getByRole('textbox', { name: 'Subject' }),
        'the draft Subject survives switching away and back',
      ).toHaveValue(draftSubject);
      await expect(
        page.locator(EDITOR).first(),
        'the draft body survives switching away and back',
      ).toContainText(draftBody);
    });
  },
);
