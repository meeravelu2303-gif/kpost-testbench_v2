import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  asGroupCreator,
  createQaGroup,
  deleteQaGroup,
  GROUP_CREATOR,
  groupMember,
  type QaGroup,
} from '../support/groups';
import { openGroupConversation } from '../support/katchup';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Katchup Group Info panel (FR-GM-001/002, 004-007, 016): admin view, member quick actions, the
 * three-dot menu and the activity feed. Selectors from `bubble/KatchupMessage/KatchupMessage.js`.
 * The browser account is a second admin; no API call logs in as it (one session per account).
 */
const K = AUTH_PROFILES.kpost;
const VIEWER: Principal | undefined = K.principals.find((p) => p.key === 'personal'); // the browser
const OTHER: Principal | undefined = K.principals.find((p) => p.key === 'victim');
const ADDED: Principal | undefined = K.principals.find((p) => p.key === 'personal-4');

/** Creator = personal-3; the browser's account is a second admin; `victim` is a plain member. */
function createGroup(
  endpoints: Parameters<typeof createQaGroup>[0],
  label: string,
): Promise<QaGroup> {
  return createQaGroup(endpoints, `group-info ${label}`, {
    admins: [VIEWER!.username],
    members: [OTHER!.username],
  });
}

/** Open the group thread, then the Group Info panel; skips (not fails) if the list never shows it. */
async function openGroupInfo(page: Page, group: QaGroup): Promise<Locator> {
  const opened = await openGroupConversation(page, group.groupKpostID);
  retryOrSkip(
    !opened,
    'the new group was not listed in Katchup right now (four reloads) — a list or session condition, not a Group Info defect',
  );
  // The header's onClick is on the name column (`.line_height`), not the wrapper; clicking the
  // wrapper's centre opens nothing.
  await page.locator('#ChatTop .background-color-katchup .line_height').first().click();
  const panel = page.locator('#ChatTop .comm_back').first();
  await expect(panel.getByText(/Katchup Group Info/i), 'the Group Info panel opens').toBeVisible({
    timeout: 15_000,
  });
  return panel;
}

test.describe(
  'KPost Katchup · Group Info (FR-GM-001/002, 004–007, 016)',
  { tag: ['@ui', '@group', '@regression'] },
  () => {
    // Four reloads of /katchup at up to ~15 s each can exceed the default budget.
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      process.env.GROUP_UI_LIFECYCLE !== 'true',
      'creates and deletes a real group; set GROUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !VIEWER ||
        !GROUP_CREATOR ||
        !OTHER ||
        !testData.kpostId ||
        testData.kpostId.includes('qa.bench') ||
        !testData.personal3KpostId ||
        testData.personal3KpostId.includes('qa.p3'),
      'needs the primary, 2nd and personal-3 QA accounts',
    );

    test(
      'FR-GM-001/002 — the thread header opens Group Info; an admin sees the member list with Admin badges @ui',
      {
        annotation: [
          { type: 'requirement', description: 'FR-GM-001' },
          { type: 'requirement', description: 'FR-GM-002' },
        ],
      },
      async ({ page, endpoints }) => {
        let group: QaGroup | undefined;
        try {
          group = await createGroup(endpoints, 'open');
          const panel = await openGroupInfo(page, group);

          await expect(
            panel.getByText(/\b0?3 Members\b/),
            'the header counts the three members',
          ).toBeVisible();
          await expect(
            panel.locator('.group_info_height'),
            'the member list renders',
          ).toBeVisible();
          // Two admins → two "Admin" badges. Counted on the panel: the viewer's "You" row sits
          // outside the scroll list.
          const badges = panel.locator('.superadmin_font, .admin_font');
          await expect(badges, 'the admin view shows one Admin badge per admin').toHaveCount(2);
          await expect(badges.nth(0), 'the first badge reads "Admin"').toHaveText(/Admin/);
          await expect(badges.nth(1), 'the second badge reads "Admin"').toHaveText(/Admin/);
          await expect(
            panel.locator('.icon-KP_05-Kall'),
            'the two OTHER members each get a row with quick actions; the viewer’s own row has none',
          ).toHaveCount(2);
        } finally {
          await deleteQaGroup(endpoints, group);
        }
      },
    );

    test(
      "FR-GM-004..006 — another member's row offers KMail / Katchup / Kall quick actions, and KMail navigates @ui",
      {
        annotation: [
          { type: 'requirement', description: 'FR-GM-004' },
          { type: 'requirement', description: 'FR-GM-005' },
          { type: 'requirement', description: 'FR-GM-006' },
        ],
      },
      async ({ page, endpoints }) => {
        let group: QaGroup | undefined;
        try {
          group = await createGroup(endpoints, 'actions');
          const panel = await openGroupInfo(page, group);
          const rows = panel.locator('.group_info_height');

          for (const [sel, label] of [
            ['.icon-KP_02-Write-Letter', 'Write (Katchup message)'],
            ['.icon-KP_03-KMail', 'KMail'],
            ['.icon-KP_04-Katchup', 'Katchup'],
            ['.icon-KP_05-Kall', 'Kall'],
          ] as const) {
            await expect(
              rows.locator(sel).first(),
              `another member's row offers the ${label} quick action`,
            ).toBeVisible({ timeout: 10_000 });
          }

          // KMail quick action: `NavToComponentGroup(id, "kmail")` navigates to /kmail for that member.
          await rows.locator('.icon-KP_03-KMail').first().click();
          await expect(page, 'the KMail quick action opens KMail').toHaveURL(/\/kmail/, {
            timeout: 15_000,
          });
        } finally {
          await deleteQaGroup(endpoints, group);
        }
      },
    );

    test(
      'FR-GM-007 — the three-dot menu lists the group-management actions for an admin @ui',
      { annotation: [{ type: 'requirement', description: 'FR-GM-007' }] },
      async ({ page, endpoints }) => {
        let group: QaGroup | undefined;
        try {
          group = await createGroup(endpoints, 'menu');
          const panel = await openGroupInfo(page, group);

          await panel.locator('.icon-KP_144---More-Vertical').first().click();
          const menu = panel.locator('.back_three_color').first();
          await expect(menu, 'the options sheet opens').toBeVisible({ timeout: 10_000 });
          for (const item of [
            'Edit Group',
            'Add Members',
            'Remove Members',
            'Add Admin',
            'Remove Admin',
          ]) {
            await expect(
              menu.getByText(item, { exact: true }),
              `menu offers "${item}"`,
            ).toBeVisible();
          }
          // Admins cannot exit a group.
          await expect(
            menu.getByText('Exit Group', { exact: true }),
            'an admin is not offered "Exit Group"',
          ).toHaveCount(0);
          await panel.locator('.icon-KP_144---More-Vertical').first().click();
          await expect(menu, 'the sheet closes on a second click').toBeHidden();
        } finally {
          await deleteQaGroup(endpoints, group);
        }
      },
    );

    test(
      'FR-GM-016 — adding a member posts an activity message into the group thread @ui',
      { annotation: [{ type: 'requirement', description: 'FR-GM-016' }] },
      async ({ page, endpoints }) => {
        test.skip(
          !ADDED || !testData.personal4KpostId || testData.personal4KpostId.includes('qa.p4'),
          'needs a configured personal-4 account to add',
        );
        let group: QaGroup | undefined;
        try {
          group = await createGroup(endpoints, 'activity');
          const added = await asGroupCreator(
            endpoints,
            'group-add-user',
            {
              groupID: group.groupID,
              groupKpostID: group.groupKpostID,
              memberDetails: [groupMember(ADDED!.username)],
            },
            'add-member',
          );
          expect(added.status, 'the add-member call is accepted').toBeLessThan(300);

          const opened = await openGroupConversation(page, group.groupKpostID);
          retryOrSkip(!opened, 'the new group was not listed in Katchup right now (four reloads)');

          // Creation already posts one "added" line; the add-member call must post a second.
          const thread = page.locator('#ChatTop, .chat-container');
          await expect(
            thread.getByText(/\badded\b/i).first(),
            'the thread shows the "added" activity message',
          ).toBeVisible({ timeout: 20_000 });
          await expect(
            thread.getByText(/\badded\b/i),
            'a second "added" message follows the add-member action',
          ).toHaveCount(2, { timeout: 20_000 });
        } finally {
          await deleteQaGroup(endpoints, group, [ADDED!.username]);
        }
      },
    );
  },
);
