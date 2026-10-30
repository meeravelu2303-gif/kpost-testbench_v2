import type { Page } from '@playwright/test';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { expect, test } from '@fixtures';
import { gotoContacts, openCreateGroup } from '../support/contacts';
import {
  createQaGroup,
  deleteQaGroup,
  GROUP_CREATOR,
  groupMenuItem,
  openGroupInfo,
  type QaGroup,
} from '../support/groups';
import { checkboxFor } from '../support/pickers';

/**
 * Group names are refused when they say nothing: Create New Group (ContactList.js) and Group Info ›
 * Edit Group (KatchupMessage.js) with an empty name or one of spaces only. createUserGroup and
 * editGroupName are blocked at the network, so a name the screen wrongly lets through is counted,
 * never saved.
 */

const K = AUTH_PROFILES.kpost;
const ADMIN: Principal | undefined = K.principals.find((p) => p.key === 'personal'); // the browser
const MEMBER: Principal | undefined = K.principals.find((p) => p.key === 'victim');

/** Blocks requests whose URL contains `path`; returns how many the screen tried to send. */
async function block(page: Page, path: string): Promise<() => number> {
  let attempts = 0;
  await page.route(`**${path}**`, (route) => {
    attempts += 1;
    return route.abort();
  });
  return () => attempts;
}

test.describe(
  'KPost Group · a group name of nothing or only spaces is refused',
  { tag: ['@ui', '@group', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default', timeout: 180_000 });

    test('Create New Group: Add Members stays disabled while the name is empty', async ({
      page,
    }) => {
      const created = await block(page, '/group/createUserGroup');
      await gotoContacts(page);
      const modal = await openCreateGroup(page);
      expect(modal, 'the Create New Group form opens').not.toBeNull();
      await expect(
        modal!.getByRole('button', { name: /Add Members$/ }).first(),
        'a group with no name cannot go on to members',
      ).toBeDisabled();
      expect(created(), 'nothing was sent').toBe(0);
    });

    test('Create New Group: a name of only spaces cannot be created', async ({ page }) => {
      test.skip(!MEMBER, 'needs the 2nd QA account');
      const created = await block(page, '/group/createUserGroup');
      await gotoContacts(page);
      const modal = await openCreateGroup(page);
      expect(modal, 'the Create New Group form opens').not.toBeNull();
      await modal!.getByPlaceholder('Group Name').first().fill('   ');
      // The icon gives the name a leading space (" Add Members").
      const addMembers = modal!.getByRole('button', { name: /Add Members$/ }).first();
      if (await addMembers.isEnabled()) {
        await addMembers.click();
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
        expect(box, 'Qatest2 is offered').not.toBeNull();
        await box!.check();
        await picker.locator('.Done-button').first().click();
        const create = page
          .getByRole('dialog')
          .filter({ hasText: /Create New Group/i })
          .getByRole('button', { name: /^Create$/ })
          .first();
        await expect(create, 'a name of spaces cannot be created').toBeDisabled();
      }
      expect(created(), 'a group named with spaces only is never sent').toBe(0);
    });

    test('Edit Group: a name of only spaces is refused and never sent', async ({
      page,
      endpoints,
    }) => {
      test.skip(
        process.env.GROUP_UI_LIFECYCLE !== 'true',
        'creates and deletes a real group; set GROUP_UI_LIFECYCLE=true',
      );
      test.skip(!ADMIN || !MEMBER || !GROUP_CREATOR, 'needs the 1st, 2nd and 3rd QA accounts');
      let group: QaGroup | undefined;
      try {
        group = await createQaGroup(endpoints, 'edit-blank', {
          admins: [ADMIN!.username],
          members: [MEMBER!.username],
        });
        const renamed = await block(page, '/group/editGroupName');
        const panel = await openGroupInfo(page, group);
        await groupMenuItem(page, panel, 'Edit Group');
        const edit = page.locator('.modal-dialog', { hasText: 'Edit Group' }).last();
        await edit.getByLabel('Group Name').fill('   ');
        const change = edit.getByRole('button', { name: 'Change' }).first();
        if (await change.isEnabled()) await change.click();
        await expect.soft(change, 'Change stays unavailable for a blank name').toBeDisabled();
        expect(renamed(), 'a group renamed to spaces only is never sent').toBe(0);
      } finally {
        await deleteQaGroup(endpoints, group);
      }
    });
  },
);
