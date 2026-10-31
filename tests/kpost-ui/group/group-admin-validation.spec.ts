import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { groupMenuItem, type QaGroup } from '../support/groups';
import { gotoKatchup } from '../support/katchup';
import { checkboxFor } from '../support/pickers';
import { toast } from '../support/validation';

/**
 * Group Info's admin rules (KatchupMessage.js checkForMultipleAdmin and the Add Admin / Add Members
 * handlers; FR-GM-012..014): an admin cannot exit, the last admin cannot be removed, Add Admin says
 * so when everyone already is one, and an existing member is not added twice. The browser's account
 * (qatest1) creates the group through the API, which reuses the browser session, so it is the only
 * admin. Every group write the screen would send is blocked; the group is deleted afterwards.
 */
const K = AUTH_PROFILES.kpost;
const ME: Principal | undefined = K.principals.find((p) => p.key === 'personal');
const MEMBER: Principal | undefined = K.principals.find((p) => p.key === 'victim');

/** A group the browser account made: its Recents row carries no id, so it is found by name. */
type MyGroup = QaGroup & { name: string };

/** Recents → the group (by name) → its header → Group Info. */
async function openMyGroupInfo(page: Page, group: MyGroup) {
  await gotoKatchup(page);
  await page.getByText(group.name, { exact: true }).first().click({ timeout: 20_000 });
  await page.locator('#ChatTop .background-color-katchup .line_height').first().click();
  const panel = page.locator('#ChatTop .comm_back').first();
  await expect(panel.getByText(/Katchup Group Info/i), 'Group Info opens').toBeVisible({
    timeout: 15_000,
  });
  return panel;
}

const member = (kpostID: string, admin = false) => ({
  createdBy: ME!.username,
  hasAdminAccess: admin ? 'Y' : 'N',
  kpostID,
  name: 'QA Bench',
  memberDesignation: '',
  privacyStatus: 'Y',
  remarks: 'created',
});

async function createMyGroup(
  endpoints: EndpointExecutor,
  label: string,
  members: Array<{ id: string; admin: boolean }>,
): Promise<MyGroup> {
  const name = `QA UI ${label} ${Date.now()}`;
  const ex = await endpoints.sendTo(
    'group-create',
    {
      body: {
        activeStatus: 'Y',
        createdBy: ME!.username,
        groupPicturePath: null,
        groupCreateAccess: true,
        groupKpostName: name,
        isPrivateGroup: 'N',
        memberDetails: [member(ME!.username, true), ...members.map((m) => member(m.id, m.admin))],
      },
    },
    { label: `group-admin-validation:create-${label}`, allowLiveWrite: true },
  );
  const parsed = ex.json();
  const data = ((parsed.ok ? parsed.value : {}) as { data?: Record<string, unknown> }).data ?? {};
  expect(data.groupKpostID, `the group is created (${ex.status})`).toBeTruthy();
  return {
    name,
    groupKpostID: String(data.groupKpostID),
    groupID: Number(data.groupID),
    members: [ME!.username, ...members.map((m) => m.id)],
  };
}

async function deleteMyGroup(endpoints: EndpointExecutor, group?: QaGroup): Promise<void> {
  if (!group) return;
  const others = group.members.filter((id) => id !== ME!.username);
  const options = { label: 'group-admin-validation:cleanup', allowLiveWrite: true };
  if (others.length)
    await endpoints
      .sendTo(
        'group-remove-member',
        {
          body: {
            memberKpostIdList: others,
            groupID: group.groupID,
            groupKpostID: group.groupKpostID,
          },
        },
        options,
      )
      .catch(() => undefined);
  await endpoints
    .sendTo(
      'group-delete',
      { body: { groupID: group.groupID, groupKpostID: group.groupKpostID } },
      options,
    )
    .catch(() => undefined);
}

test.describe(
  'KPost Group · Group Info admin rules',
  { tag: ['@ui', '@group', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default', timeout: 180_000 });
    test.skip(
      process.env.GROUP_UI_LIFECYCLE !== 'true',
      'creates and deletes a real group; set GROUP_UI_LIFECYCLE=true',
    );
    test.skip(!ME || !MEMBER, 'needs the 1st and 2nd QA accounts');

    test.beforeEach(async ({ page }) => {
      // The screen's own group writes never reach the server.
      await page.route(/\/group\/(leaveFromGroup|addOrRemoveAdminAccess|addUserToGroup)/, (route) =>
        route.abort(),
      );
    });

    test('an admin cannot exit the group (FR-GM-014)', async ({ page, endpoints }) => {
      let group: MyGroup | undefined;
      try {
        group = await createMyGroup(endpoints, 'admin-exit', [
          { id: MEMBER!.username, admin: false },
        ]);
        const panel = await openMyGroupInfo(page, group);
        // The live screen does not offer Exit Group to an admin; if it ever does, it must refuse.
        await panel.locator('.icon-KP_144---More-Vertical').first().click();
        const exit = page.locator('.back_three_color').getByText('Exit Group', { exact: true });
        if (
          await exit
            .first()
            .isVisible({ timeout: 3_000 })
            .catch(() => false)
        ) {
          await exit.first().click();
          await expect(
            toast(page, 'Group admins cannot exit the group'),
            'the admin is told they cannot exit',
          ).toBeVisible({ timeout: 10_000 });
        } else {
          await expect(exit, 'an admin is not offered Exit Group').toHaveCount(0);
        }
      } finally {
        await deleteMyGroup(endpoints, group);
      }
    });

    test('the last admin cannot be removed', async ({ page, endpoints }) => {
      let group: MyGroup | undefined;
      try {
        group = await createMyGroup(endpoints, 'last-admin', [
          { id: MEMBER!.username, admin: false },
        ]);
        const panel = await openMyGroupInfo(page, group);
        await groupMenuItem(page, panel, 'Remove Admin');
        await expect(
          toast(page, 'Each group must have at least one admin. Please add another admin first'),
          'the only admin is told the group needs one',
        ).toBeVisible({ timeout: 10_000 });
      } finally {
        await deleteMyGroup(endpoints, group);
      }
    });

    test('Add Admin says so when every member already is one', async ({ page, endpoints }) => {
      let group: MyGroup | undefined;
      try {
        group = await createMyGroup(endpoints, 'all-admins', [
          { id: MEMBER!.username, admin: true },
        ]);
        const panel = await openMyGroupInfo(page, group);
        await groupMenuItem(page, panel, 'Add Admin');
        await expect(
          toast(page, 'All group members are already admins'),
          'there is nobody left to promote',
        ).toBeVisible({ timeout: 10_000 });
      } finally {
        await deleteMyGroup(endpoints, group);
      }
    });

    test('an existing member is not added again', async ({ page, endpoints }) => {
      let group: MyGroup | undefined;
      try {
        group = await createMyGroup(endpoints, 'readd', [{ id: MEMBER!.username, admin: false }]);
        let added = 0;
        page.on('request', (r) => {
          if (r.url().includes('/group/addUserToGroup')) added += 1;
        });
        const panel = await openMyGroupInfo(page, group);
        await groupMenuItem(page, panel, 'Add Members');
        const picker = page
          .locator('.modal-dialog')
          .filter({ has: page.locator('.Done-button') })
          .last();
        await picker
          .getByPlaceholder('Search Contacts')
          .first()
          .fill('Qatest2')
          .catch(() => undefined);
        const box = await checkboxFor(picker, /Qatest2\b/i);
        expect(box, 'the existing member is listed in the picker').not.toBeNull();
        if (await box!.isDisabled()) {
          // The live screen greys an existing member out, so they cannot be picked.
          await expect(box!, 'an existing member cannot be ticked').toBeDisabled();
        } else {
          // Offered anyway: choosing them must be refused with the screen's own message.
          await box!.check();
          await picker.locator('.Done-button').first().click();
          await expect(
            toast(page, 'Selected Contact is already a group member !'),
            'the user is told they are already a member',
          ).toBeVisible({ timeout: 10_000 });
        }
        expect(added, 'an existing member is never sent to addUserToGroup').toBe(0);
      } finally {
        await deleteMyGroup(endpoints, group);
      }
    });
  },
);
