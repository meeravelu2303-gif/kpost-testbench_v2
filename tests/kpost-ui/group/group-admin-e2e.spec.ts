import type { Locator, Page, Response } from '@playwright/test';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { expect, test } from '@fixtures';
import { createQaGroup, deleteQaGroup, GROUP_CREATOR, type QaGroup } from '../support/groups';
import { EDITOR, openGroupConversation } from '../support/katchup';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Group admin actions on screen, as a second admin (the browser's account; the group is created by
 * personal-3 over the API): rename, change the group photo, add a member, make them admin, remove
 * that admin access, remove the member, and post to Selected Members only. Each step checks the
 * server's answer. Selectors from bubble/KatchupMessage/KatchupMessage.js (Group Info three-dot menu)
 * and bubble/WriteMessage/WriteMessage.js. The group is deleted afterwards.
 */
const K = AUTH_PROFILES.kpost;
const ADMIN: Principal | undefined = K.principals.find((p) => p.key === 'personal'); // the browser
const MEMBER: Principal | undefined = K.principals.find((p) => p.key === 'victim');
const ADDED: Principal | undefined = K.principals.find((p) => p.key === 'personal-4');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+6ZlWAAAAAElFTkSuQmCC',
  'base64',
);

async function openGroupInfo(page: Page, group: QaGroup): Promise<Locator> {
  const opened = await openGroupConversation(page, group.groupKpostID);
  retryOrSkip(!opened, 'the new group was not listed in Katchup right now (four reloads)');
  await page.locator('#ChatTop .background-color-katchup .line_height').first().click();
  const panel = page.locator('#ChatTop .comm_back').first();
  await expect(panel.getByText(/Katchup Group Info/i), 'Group Info opens').toBeVisible({
    timeout: 15_000,
  });
  return panel;
}

async function menuItem(page: Page, panel: Locator, item: string): Promise<void> {
  await panel.locator('.icon-KP_144---More-Vertical').first().click();
  await page.locator('.back_three_color').getByText(item, { exact: true }).first().click();
}

async function answerTo(page: Page, path: string, act: () => Promise<void>): Promise<Response> {
  const answer = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes(path),
    { timeout: 30_000 },
  );
  await act();
  return answer;
}

const statusOf = async (r: Response): Promise<string | undefined> =>
  ((await r.json().catch(() => ({}))) as { status?: string }).status;
const sent = (r: Response): Record<string, unknown> =>
  JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>;
const toast = (page: Page, text: RegExp | string): Locator =>
  page.locator('.Toastify__toast').filter({ hasText: text }).first();
const dialog = (page: Page, title: string): Locator =>
  page.locator('.modal-dialog', { hasText: title }).last();

test.describe(
  'KPost Katchup · group admin actions on screen @ui',
  { tag: ['@ui', '@group', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default', timeout: 240_000 });
    test.skip(
      process.env.GROUP_UI_LIFECYCLE !== 'true',
      'creates and deletes a real group; set GROUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !ADMIN || !MEMBER || !ADDED || !GROUP_CREATOR,
      'needs the 1st, 2nd, 3rd and 4th QA accounts',
    );

    test('a second admin renames the group and changes its photo', async ({ page, endpoints }) => {
      let group: QaGroup | undefined;
      try {
        group = await createQaGroup(endpoints, 'admin-rename', {
          admins: [ADMIN!.username],
          members: [MEMBER!.username],
        });
        const renamed = `QA UI renamed ${Date.now()}`;
        const panel = await openGroupInfo(page, group);

        await test.step('Edit Group › Group Name › Change (editGroupName)', async () => {
          await menuItem(page, panel, 'Edit Group');
          const edit = dialog(page, 'Edit Group');
          await edit.getByLabel('Group Name').fill(renamed);
          const saved = await answerTo(page, '/group/editGroupName', () =>
            edit.getByRole('button', { name: 'Change' }).click(),
          );
          expect.soft(sent(saved).groupKpostName, 'the new name is sent').toBe(renamed);
          expect.soft(await statusOf(saved), 'the server renames it').toBe('SUCCESS');
          await expect.soft(toast(page, 'Group Name Changed successfully')).toBeVisible();
          await expect
            .soft(panel.getByText(renamed).first(), 'Group Info shows the new name')
            .toBeVisible({ timeout: 15_000 });
        });

        await test.step('Edit Group › photo › Image Cropper › Done (updateGroupProfileImage)', async () => {
          await menuItem(page, panel, 'Edit Group');
          await page.locator('#ImgInput').setInputFiles({
            name: 'qa-group.png',
            mimeType: 'image/png',
            buffer: PNG_1X1,
          });
          const cropper = dialog(page, 'Image Cropper');
          await expect(cropper, 'the cropper opens').toBeVisible({ timeout: 15_000 });
          const uploaded = await answerTo(page, '/group/updateGroupProfileImage', () =>
            cropper.getByRole('button', { name: /^Done$/ }).click(),
          );
          expect.soft(await statusOf(uploaded), 'the server stores the photo').toBe('SUCCESS');
          await expect.soft(toast(page, 'Profile upload successfully')).toBeVisible();
        });
      } finally {
        await deleteQaGroup(endpoints, group);
      }
    });

    test('a second admin adds a member, makes them admin, revokes it and removes them', async ({
      page,
      endpoints,
    }) => {
      let group: QaGroup | undefined;
      try {
        group = await createQaGroup(endpoints, 'admin-members', {
          admins: [ADMIN!.username],
          members: [MEMBER!.username],
        });
        const panel = await openGroupInfo(page, group);
        const added = ADDED!.username;

        await test.step('Add Members › pick the new person › Done (addUserToGroup)', async () => {
          await menuItem(page, panel, 'Add Members');
          const picker = dialog(page, 'Add Members');
          await picker.getByRole('searchbox').first().fill(added.split('@')[0]!);
          const row = picker
            .locator('.contactBar_Dropdown')
            .filter({ hasText: /qatest4/i })
            .first();
          await row.locator('input[type="checkbox"]').check();
          const response = await answerTo(page, '/group/addUserToGroup', () =>
            picker.getByRole('button', { name: /^Done$/ }).click(),
          );
          const members = (sent(response).memberDetails as Array<{ kpostID?: string }>) ?? [];
          expect
            .soft(
              members.map((m) => m.kpostID),
              'the new person is sent',
            )
            .toContain(added);
          expect.soft(await statusOf(response), 'the server adds them').toBe('SUCCESS');
          await expect.soft(toast(page, 'Group Member Added Successfully')).toBeVisible();
        });

        await test.step('Add Admin › Add on their row (addOrRemoveAdminAccess Y)', async () => {
          await menuItem(page, panel, 'Add Admin');
          const list = page.locator('#ChatTop .comm_back').filter({ hasText: 'Add Admin Member' });
          const row = list
            .locator('.contactBar_Dropdown')
            .filter({ hasText: /qatest4/i })
            .first();
          const response = await answerTo(page, '/group/addOrRemoveAdminAccess', () =>
            row.getByRole('button', { name: /^Add$/ }).click(),
          );
          expect.soft(sent(response).hasAdminAccess, 'admin access is granted').toBe('Y');
          expect.soft(await statusOf(response), 'the server records it').toBe('SUCCESS');
        });

        await test.step('Remove Admin › Remove › Confirm (addOrRemoveAdminAccess N)', async () => {
          await menuItem(page, panel, 'Remove Admin');
          const list = page
            .locator('#ChatTop .comm_back')
            .filter({ hasText: 'Remove Admin Member' });
          const row = list
            .locator('.contactBar_Dropdown')
            .filter({ hasText: /qatest4/i })
            .first();
          await row.getByRole('button', { name: /^Remove$/ }).click();
          const confirm = dialog(page, 'Remove Admin Member');
          const response = await answerTo(page, '/group/addOrRemoveAdminAccess', () =>
            confirm.getByRole('button', { name: /^Confirm$/ }).click(),
          );
          expect.soft(sent(response).hasAdminAccess, 'admin access is revoked').toBe('N');
          expect.soft(await statusOf(response), 'the server records it').toBe('SUCCESS');
        });

        await test.step('Remove Members › tick › Remove › Confirm (removeGroupMember)', async () => {
          await menuItem(page, panel, 'Remove Members');
          const list = page
            .locator('#ChatTop .comm_back')
            .filter({ hasText: 'Remove Group Members' });
          const row = list
            .locator('.contactBar_Dropdown')
            .filter({ hasText: /qatest4/i })
            .first();
          await row.locator('input[type="checkbox"]').check();
          await list.getByRole('button', { name: /^Remove$/ }).click();
          const confirm = dialog(page, 'Remove Member');
          const response = await answerTo(page, '/group/removeGroupMember', () =>
            confirm.getByRole('button', { name: /^Confirm$/ }).click(),
          );
          expect
            .soft(sent(response).memberKpostIdList, 'the removed person is sent')
            .toEqual([added]);
          expect.soft(await statusOf(response), 'the server removes them').toBe('SUCCESS');
          await expect.soft(toast(page, 'Group Member Removed successfully')).toBeVisible();
        });
      } finally {
        await deleteQaGroup(endpoints, group, [ADDED!.username]);
      }
    });

    test('a post to Selected Members goes only to the people picked', async ({
      page,
      endpoints,
    }) => {
      let group: QaGroup | undefined;
      try {
        // Creator + browser + two members: picking one of the three others is a partial selection.
        group = await createQaGroup(endpoints, 'admin-selected', {
          admins: [ADMIN!.username],
          members: [MEMBER!.username, ADDED!.username],
        });
        const opened = await openGroupConversation(page, group.groupKpostID);
        retryOrSkip(!opened, 'the new group was not listed in Katchup right now (four reloads)');
        const subject = `QA selected ${Date.now()}`;
        await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
        await page.locator(EDITOR).first().click();
        await page.keyboard.type('QA bench post to selected members');

        await page.getByRole('button', { name: 'Send message' }).first().click();
        await page.locator('.grp_options').getByText('Selected Members', { exact: true }).click();
        const pick = dialog(page, 'Select Members');
        await pick
          .locator('div')
          .filter({ hasText: /qatest2/i })
          .getByRole('checkbox')
          .first()
          .check();
        await pick.getByRole('button', { name: /^Done$/ }).click();

        const response = await answerTo(page, '/katchup/sendMessage', () =>
          page.getByRole('button', { name: 'Send message' }).first().click(),
        );
        const body = sent(response);
        expect.soft(body.selectedMembers, 'the post is marked as for selected members').toBe('Y');
        expect
          .soft(body.groupmemberList, 'only the picked member is listed')
          .toEqual([MEMBER!.username]);
        expect.soft(await statusOf(response), 'the server accepts the post').toBe('SUCCESS');
        await expect
          .soft(page.locator('.all_mem_font').filter({ hasText: 'Selected Members' }).last())
          .toBeVisible({ timeout: 15_000 });
      } finally {
        await deleteQaGroup(endpoints, group);
      }
    });
  },
);
