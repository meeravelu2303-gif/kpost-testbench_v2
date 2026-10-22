import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { EDITOR, gotoKatchup, parkPointerAwayFromSideMenu } from '../support/katchup';
import { settleFrames } from '../support/settle';

/**
 * Katchup DRAFT persistence (coverage gap — no draft test existed at any tier).
 *
 * Confirmed from the live frontend source (bubble/Katchup.js `DraftMsg`/`handleDraftMsg`,
 * WriteMessage.js:148 `setDraft`): a draft is **client-side React state only** — there is no draft API
 * and no localStorage, and the per-contact keying in `handleDraftMsg` is commented out. So the testable
 * contract is the IN-SESSION one: text typed into a conversation's composer survives switching to
 * another conversation and back, WITHOUT a page reload (a reload clears the useState and is out of
 * scope — drafts are not persisted across reloads by design).
 *
 * This asserts the correct behaviour: switch away from a half-typed message and back, and the draft is
 * still there. If it comes back empty (or shows the other conversation's text), that is a real draft
 * defect — the commented-out per-contact keying — and this surfaces it.
 *
 * Switching is done by clicking conversation ROWS in the left list (in-SPA), never `openConversation`
 * (which does a full /katchup navigation and would reset the draft state). Needs a second real contact
 * (qatest3) alongside the 2nd QA account. Does not send anything, so it is read-only aside from typing;
 * still gated KATCHUP_UI_LIFECYCLE for consistency with the other composer specs.
 *
 * NOTE (needs one live selector-tuning pass): the composer-open control (`.msg-arrow`) and the
 * row ids are reused from the shared helpers; confirm the draft actually restores on the first live run
 * (the source suggests it may not be per-contact).
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

      // One load of the Katchup list; every switch after this is an in-SPA row click (no reload, so
      // the draft's React state is never torn down).
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

      // The draft must still be there — both the Subject and the body.
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
