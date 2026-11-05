import type { Locator, Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { gotoContacts, openCreateGroup } from '../support/contacts';
import { checkboxFor } from '../support/pickers';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Create New Group (Katchup › Contacts, `bubble/ContactList/ContactList.js` handleCreateGroup →
 * Services/Contacts.js PostCreategroup → POST /group/createUserGroup/): when the server refuses the
 * group or does not answer, the user is told and the form stays filled so they can try again. Every
 * createUserGroup call is answered in the browser, so no group is ever created.
 */
const CREATE = '**/group/createUserGroup/**';
const BOUNDARY = /Something went wrong/i;
const ERROR_TEXT = /error|fail|unable|could not|try again|went wrong|not created/i;

/** True when an error message (toast, alert or inline error) becomes visible. */
async function userIsTold(page: Page): Promise<boolean> {
  return page
    .locator('.Toastify__toast, [role="alert"], .alert-danger, [class*="error" i]', {
      hasText: ERROR_TEXT,
    })
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

/** Contacts › Create group › name › Add Members (Qatest2) › Done; returns the form and its Create. */
async function fillCreateGroup(
  page: Page,
  name: string,
): Promise<{ form: Locator; create: Locator }> {
  const opened = await gotoContacts(page);
  retryOrSkip(
    !opened,
    'the Contacts panel was not showing right now (session or load condition, not a Group defect)',
  );
  const modal = await openCreateGroup(page);
  expect(modal, 'the Create New Group form opens').not.toBeNull();
  await modal!.getByPlaceholder('Group Name').first().fill(name);
  await modal!
    .getByRole('button', { name: /Add Members$/ })
    .first()
    .click();
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
  expect(box, 'Qatest2 is offered in the member picker').not.toBeNull();
  await box!.check();
  await picker.locator('.Done-button').first().click();
  const form = page.getByRole('dialog').filter({ hasText: /Create New Group/i });
  await expect(form.getByText(/Group Members/i).first(), 'the chosen member is listed').toBeVisible(
    { timeout: 15_000 },
  );
  const create = form.getByRole('button', { name: /^Create$/ }).first();
  await expect(create, 'a named group with a member can be created').toBeEnabled();
  return { form, create };
}

test.describe(
  'KPost Group · Create New Group reports a group the server refuses',
  {
    tag: ['@ui', '@group', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );
    test.skip(
      !testData.victimKpostId || testData.victimKpostId.includes('qa.victim'),
      'needs the 2nd QA account as the member (QA_VICTIM_KPOST_ID)',
    );

    test('a create the server answers with HTTP 500 is reported and the form stays filled @ui', async ({
      page,
    }) => {
      let calls = 0;
      await page.route(CREATE, (route) => {
        calls += 1;
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'FAILURE', statusCode: 500, message: '' }),
        });
      });
      const name = `QA api-handling grp ${Date.now()}`;
      const stop = watchUiHealth(page);
      const { form, create } = await fillCreateGroup(page, name);
      await create.click();
      await expect.poll(() => calls, { message: 'the create request fired' }).toBeGreaterThan(0);

      const told = await userIsTold(page);
      test.info().annotations.push({
        type: 'observed',
        description: told ? 'error shown on HTTP 500' : 'HTTP 500 on create gave NO visible error',
      });
      expect(told, 'a group the server failed to create must be reported to the user').toBe(true);
      await expect(
        form.getByPlaceholder('Group Name').first(),
        'the typed name is kept',
      ).toHaveValue(name);
      await expect(page.getByText(BOUNDARY), 'no error boundary').toHaveCount(0);
      expect(stop().pageErrors, 'no uncaught error on a failed create').toEqual([]);
    });

    test('a create the server refuses (FAILURE envelope) is reported @ui', async ({ page }) => {
      let calls = 0;
      await page.route(CREATE, (route) => {
        calls += 1;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'FAILURE',
            statusCode: 400,
            message: 'Group could not be created',
          }),
        });
      });
      const { create } = await fillCreateGroup(page, `QA api-handling grp ${Date.now()}`);
      await create.click();
      await expect.poll(() => calls, { message: 'the create request fired' }).toBeGreaterThan(0);
      const told = await userIsTold(page);
      test.info().annotations.push({
        type: 'observed',
        description: told ? 'error shown on refusal' : 'refused create gave NO visible error',
      });
      expect(told, 'a group the server refuses must be reported to the user').toBe(true);
      await expect(
        page.locator('.Toastify__toast').filter({ hasText: /Group Created Successfully/i }),
        'a refused group is never announced as created',
      ).toHaveCount(0);
    });

    test('a create that gets no answer (network failure) is reported, and Create works again @ui', async ({
      page,
    }) => {
      let calls = 0;
      await page.route(CREATE, (route) => {
        calls += 1;
        return route.abort('failed');
      });
      const stop = watchUiHealth(page);
      const { create } = await fillCreateGroup(page, `QA api-handling grp ${Date.now()}`);
      await create.click();
      await expect.poll(() => calls, { message: 'the create request fired' }).toBeGreaterThan(0);
      const told = await userIsTold(page);
      test.info().annotations.push({
        type: 'observed',
        description: told
          ? 'error shown on network failure'
          : 'network failure on create gave NO visible feedback (the catch only logs)',
      });
      expect(told, 'a create that never reached the server must tell the user').toBe(true);
      await expect(create, 'Create is enabled again so the user can retry').toBeEnabled({
        timeout: 10_000,
      });
      expect(stop().pageErrors, 'no uncaught error on a network failure').toEqual([]);
    });
  },
);
