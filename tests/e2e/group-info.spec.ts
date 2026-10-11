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
} from './support/groups';
import { openGroupConversation } from './support/katchup';

/**
 * Katchup **Group Info** — the FRD rows that were UI GAPs (`requirements-frd.md`, Group Management):
 *
 *   FR-GM-001..002  open Group Info from the thread header; an admin sees the admin view
 *   FR-GM-004..006  per-member quick actions (KMail / Katchup / Kall) on another member's row
 *   FR-GM-007       the Group Management three-dot menu (Edit · Add Members · Remove Members ·
 *                   Add Admin · Remove Admin · Exit Group)
 *   FR-GM-016       the activity feed: an admin action posts a system message into the thread
 *
 * Read from source (`bubble/KatchupMessage/KatchupMessage.js`, 2026-10-10):
 *   - the thread header `ContactBar` (`.background-color-katchup`) `onClick` → `setGroupInfo(true)`;
 *   - the panel renders `#ChatTop .comm_back` titled "Katchup Group Info", a `ContactBar` with
 *     "N Members", the three-dot `.icon-KP_144---More-Vertical` whose menu is `.back_three_color`
 *     (admin-only items guarded by `isGroupAdmin`, "Exit Group" for everyone), a search bar and the
 *     member list in `.group_info_height`; every row that is not the viewer carries
 *     `.icon-KP_02-Write-Letter`, `.icon-KP_03-KMail`, `.icon-KP_04-Katchup`, `.icon-KP_05-Kall`
 *     (`NavToComponentGroup`); the creator's row is labelled "Admin" (`.superadmin_font`), other
 *     admins' rows "Admin" (`.admin_font`).
 *   - backend `GroupServiceImpl` posts a Katchup message into the group on add / remove / leave
 *     ("<admin name> added <names>", "... Removed ...", "<name> Left the Group").
 *
 * The group comes from `support/groups.ts`: created by personal-3 with the browser's account as a
 * second admin (so `isGroupAdmin` is true and the admin view renders) and `victim` as a plain member.
 * No API call in this file ever authenticates as the browser's account — doing so kicks the browser
 * session to `/login` (KPost keeps one session per account; 12/12 failures on 2026-10-10).
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
  test.skip(
    !opened,
    'the new group was not listed in Katchup right now (four reloads) — a list or session condition, not a Group Info defect',
  );
  // `ContactBar` attaches the header's `onClick` to its name/description column
  // (`div.line_height`, `common/ContactBar/ContactBar.js`), not to the `.background-color-katchup`
  // wrapper — a click on the wrapper's centre lands beside the column and opens nothing (measured
  // 2026-10-10: the click registered on `.contactBar_Dropdown.background-color-katchup`, no panel).
  await page.locator('#ChatTop .background-color-katchup .line_height').first().click();
  const panel = page.locator('#ChatTop .comm_back').first();
  await expect(panel.getByText(/Katchup Group Info/i), 'the Group Info panel opens').toBeVisible({
    timeout: 15_000,
  });
  return panel;
}

test.describe('KPost Katchup · Group Info (FR-GM-001/002, 004–007, 016)', { tag: '@ui' }, () => {
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

  test('FR-GM-001/002 — the thread header opens Group Info; an admin sees the member list with Admin badges @ui', async ({
    page,
    endpoints,
  }) => {
    let group: QaGroup | undefined;
    try {
      group = await createGroup(endpoints, 'open');
      const panel = await openGroupInfo(page, group);

      await expect(
        panel.getByText(/\b0?3 Members\b/),
        'the header counts the three members',
      ).toBeVisible();
      await expect(panel.locator('.group_info_height'), 'the member list renders').toBeVisible();
      // Two admins (creator + the viewer) → two badges: the creator's `.superadmin_font` and the
      // viewer's `.admin_font` (KatchupMessage.js), both reading "Admin"; one plain member without.
      // (Counted on the panel, not on the scroll list: the viewer's own "You" row sits outside it.)
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
  });

  test("FR-GM-004..006 — another member's row offers KMail / Katchup / Kall quick actions, and KMail navigates @ui", async ({
    page,
    endpoints,
  }) => {
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
  });

  test('FR-GM-007 — the three-dot menu lists the group-management actions for an admin @ui', async ({
    page,
    endpoints,
  }) => {
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
        'Exit Group',
      ]) {
        await expect(menu.getByText(item, { exact: true }), `menu offers "${item}"`).toBeVisible();
      }
      await panel.locator('.icon-KP_144---More-Vertical').first().click();
      await expect(menu, 'the sheet closes on a second click').toBeHidden();
    } finally {
      await deleteQaGroup(endpoints, group);
    }
  });

  test('FR-GM-016 — adding a member posts an activity message into the group thread @ui', async ({
    page,
    endpoints,
  }) => {
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
      test.skip(!opened, 'the new group was not listed in Katchup right now (four reloads)');

      // Backend: `<admin first last> added <member names>` is sent as a Katchup message to the group.
      // The creation itself already posts one "added" line (creator added the initial members); the
      // add-member call must post a second, naming the added account.
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
  });
});
