import { STORAGE_STATE_2, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openGroupConversation } from '../support/katchup';
import { createQaGroup, deleteQaGroup, type QaGroup } from '../support/groups';
import { openSession, requireAccounts, requireFlags } from './support/journey';

/**
 * Journey 5: C creates a group with A and B via the API; A posts to all members; B sees the post; C
 * cleans up. Known defect #1343: opening a group thread answers 500 and the post may never render.
 */
test.describe(
  'JOURNEY 5 · a group',
  {
    tag: [TAGS.ui, TAGS.journey, TAGS.group, TAGS.katchup, TAGS.regression],
  },
  () => {
    test.describe.configure({ timeout: 240_000 });
    requireAccounts('A', 'B', 'C');
    requireFlags('GROUP_UI_LIFECYCLE', 'KATCHUP_UI_LIFECYCLE');

    test("an organizer creates a group, A posts to it, B sees A's post", async ({
      page,
      browser,
      endpoints,
    }) => {
      const subject = `QA journey group post ${Date.now()}`;
      let group: QaGroup | undefined;
      const b = await openSession(browser, STORAGE_STATE_2);

      try {
        await test.step('C creates the group with A and B', async () => {
          group = await createQaGroup(endpoints, 'journey', {
            members: [testData.kpostId, testData.victimKpostId],
          });
        });

        await test.step('A finds the new group in Katchup and opens it', async () => {
          expect(
            await openGroupConversation(page, group!.groupKpostID),
            'the new group is listed for A',
          ).toBe(true);
        });

        await test.step('A posts to all members (#1343; UNPROVEN STEP: All Members)', async () => {
          await page.locator('.msg-arrow').first().click();
          await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
          await page.locator('.ql-editor[contenteditable="true"]').first().click();
          await page.keyboard.type('QA journey — a post to the whole group');
          await page.keyboard.press('Enter');
          // A multi-member group asks who to post to first.
          const audience = page.locator('.grp_optPosition, .grp_optExpandPosition').first();
          if (await audience.isVisible({ timeout: 5_000 }).catch(() => false))
            await audience
              .getByText(/All Members/i)
              .first()
              .click();
          await expect(
            page.locator('[id]').filter({ hasText: subject }).last(),
            "A's post appears in the group thread",
          ).toBeVisible({ timeout: 20_000 });
        });

        await test.step("B opens the group and sees A's post", async () => {
          expect(
            await openGroupConversation(b.page, group!.groupKpostID),
            'the group is listed for B',
          ).toBe(true);
          await expect(b.page.getByText(subject).first(), "B sees A's post").toBeVisible({
            timeout: 30_000,
          });
        });
      } finally {
        await deleteQaGroup(endpoints, group);
        await b.context.close();
      }
    });
  },
);
