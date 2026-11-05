import type { Locator, Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { healthFailures, isResponsive, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { contactsSearchBox, gotoContacts, openCreateGroup } from '../../support/contacts';
import { checkboxFor } from '../../support/pickers';
import { retryOrSkip } from '../../../support/live-condition';

/**
 * Create New Group under a bad network (`bubble/ContactList/ContactList.js` handleCreateGroup, its
 * `isCreating` flag disables Create while a request is out): a double click sends one request, a
 * slow answer never leaves Create stuck, going offline does not lose the form, and a reload mid-create
 * does not resend. createUserGroup is always answered in the browser (a refusal), so no group is
 * ever created.
 */
const CREATE = '**/group/createUserGroup/**';
const BOUNDARY = /Something went wrong/i;
const REFUSAL = {
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ status: 'FAILURE', statusCode: 400, message: 'QA bench refusal' }),
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  'KPost Group · Create New Group under a slow or lost network',
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

    test('a double click on Create sends one create request @ui', async ({ page }) => {
      let calls = 0;
      await page.route(CREATE, async (route) => {
        calls += 1;
        await delay(3_000);
        await route.fulfill(REFUSAL).catch(() => undefined);
      });
      const { create } = await fillCreateGroup(page, `QA resilience grp ${Date.now()}`);
      const answered = page.waitForResponse((r) => r.url().includes('/group/createUserGroup'), {
        timeout: 20_000,
      });
      await create.dblclick();
      await answered;
      test.info().annotations.push({ type: 'observed', description: `create requests: ${calls}` });
      expect(calls, 'one double click must create one group, not two').toBe(1);
    });

    test('a slow create keeps Create disabled while it waits, then frees it @ui', async ({
      page,
    }) => {
      await page.route(CREATE, async (route) => {
        await delay(6_000);
        await route.fulfill(REFUSAL).catch(() => undefined);
      });
      const { create } = await fillCreateGroup(page, `QA resilience grp ${Date.now()}`);
      const answered = page.waitForResponse((r) => r.url().includes('/group/createUserGroup'), {
        timeout: 30_000,
      });
      await create.click();
      await expect(create, 'Create is disabled while the request is out').toBeDisabled({
        timeout: 3_000,
      });
      await answered;
      await expect(create, 'Create is usable again once the slow answer arrives').toBeEnabled({
        timeout: 10_000,
      });
    });

    test('going offline at Create keeps the form, and Create works once back online @ui', async ({
      page,
      context,
    }) => {
      let calls = 0;
      await page.route(CREATE, (route) => {
        calls += 1;
        return route.fulfill(REFUSAL);
      });
      const name = `QA resilience grp ${Date.now()}`;
      const { form, create } = await fillCreateGroup(page, name);
      const stop = watchUiHealth(page);
      await context.setOffline(true);
      try {
        await create.click();
        await expect(page.getByText(BOUNDARY), 'no error boundary while offline').toHaveCount(0);
        expect(await isResponsive(page), 'the screen does not freeze offline').toBe(true);
        await expect(
          form.getByPlaceholder('Group Name').first(),
          'the typed name survives the dropped network',
        ).toHaveValue(name);
      } finally {
        await context.setOffline(false);
      }
      const before = calls;
      await expect(create, 'Create is usable again once online').toBeEnabled({ timeout: 15_000 });
      await create.click();
      await expect
        .poll(() => calls, { message: 'a retry once online sends the create request' })
        .toBeGreaterThan(before);
      expect(healthFailures(stop()), 'no crash across offline and back').toEqual([]);
    });

    test('a reload while the create is out brings Contacts back and does not resend @ui', async ({
      page,
    }) => {
      let calls = 0;
      await page.route(CREATE, async (route) => {
        calls += 1;
        await delay(20_000);
        await route.fulfill(REFUSAL).catch(() => undefined);
      });
      const { create } = await fillCreateGroup(page, `QA resilience grp ${Date.now()}`);
      await create.click();
      await expect.poll(() => calls, { message: 'the create request fired' }).toBe(1);
      const stop = watchUiHealth(page);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      const back = await gotoContacts(page);
      expect(back, 'the Contacts panel comes back after the reload').toBe(true);
      await expect(contactsSearchBox(page), 'Contacts is usable').toBeVisible();
      await expect(page.getByText(BOUNDARY), 'no error boundary after the reload').toHaveCount(0);
      expect(calls, 'the reload must not resend the create').toBe(1);
      expect(stop().pageErrors, 'no uncaught error after the reload').toEqual([]);
    });
  },
);
