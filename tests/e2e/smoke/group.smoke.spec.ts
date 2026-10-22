import { TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { createQaGroup, deleteQaGroup, GROUP_CREATOR, type QaGroup } from '../support/groups';
import { openGroupConversation } from '../support/katchup';
import { requirePersonalAccount } from './smoke-ui';

/**
 * UI SMOKE · Group — a group the user is added to appears in their Katchup and opens. The group is
 * created and deleted through the API as qatest3 (never as qatest1, whose browser this is: one session
 * per account), so the check is net zero.
 */
test.describe(
  'SMOKE · UI · Group',
  { tag: [TAGS.ui, TAGS.group, TAGS.smoke, TAGS.sanity, TAGS.regression] },
  () => {
    requirePersonalAccount();
    test.skip(!GROUP_CREATOR, 'needs the group-creator QA account (personal-3)');

    test('a group the user belongs to appears in Katchup and opens', async ({
      page,
      endpoints,
    }) => {
      test.setTimeout(150_000);
      let group: QaGroup | undefined;
      try {
        group = await createQaGroup(endpoints, 'smoke', { members: [testData.kpostId] });
        expect(
          await openGroupConversation(page, group.groupKpostID),
          'the new group is listed in Katchup',
        ).toBe(true);
        await expect(
          page.getByText(/QA UI smoke/).first(),
          'the group conversation opens with its name',
        ).toBeVisible({ timeout: 20_000 });
      } finally {
        await deleteQaGroup(endpoints, group);
      }
    });
  },
);
