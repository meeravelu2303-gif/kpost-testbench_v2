import type { Locator, Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { gotoKoolKall, meetingTitleField, openCreateKall } from '../../support/kall';
import { checkboxFor } from '../../support/pickers';

/**
 * Kall screen API handling, stubbed in the browser:
 * - the Recents dashboard (KallPage.js RecentKallFunc → POST /kall/kallDashboard/): a failed load
 *   must say so, not look like "no calls", and a reload recovers;
 * - Create Kool Kall (CreateKallModal.js handlesubmit → POST /kall/scheduledKall): a schedule the
 *   server refuses must be reported, not close the form as if it were made.
 * scheduledKall is always answered in the browser, so no meeting is created.
 */
const DASHBOARD = '**/kall/kallDashboard/**';
const SCHEDULE = '**/kall/scheduledKall**';
const BOUNDARY = /Something went wrong/i;
const ERROR_TEXT = /error|fail|unable|could not|try again|went wrong|not (created|scheduled)/i;

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

async function gotoKall(page: Page): Promise<void> {
  await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
}

const localDay = (offsetDays: number): string => {
  const d = new Date(Date.now() + offsetDays * 24 * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Fills a complete one-time meeting tomorrow 10:00-10:30 with Qatest2 invited (as kall-validation). */
async function fillMeeting(page: Page, modal: Locator): Promise<void> {
  await meetingTitleField(modal).fill(`QA api-handling ${Date.now()}`);
  await modal.locator('input[name="birthday"]').first().fill(localDay(1));
  const times = modal.locator('input[type="time"]');
  await times.nth(0).fill('10:00');
  await times.nth(1).fill('10:30');
  await modal
    .getByText(/^Invite$/)
    .first()
    .click();
  const picker = page
    .getByRole('dialog')
    .filter({ hasText: /Invite Participants/i })
    .last();
  await expect(picker, 'the participant picker opens').toBeVisible({ timeout: 15_000 });
  await picker
    .getByRole('searchbox')
    .first()
    .fill('Qatest2')
    .catch(() => undefined);
  const box = await checkboxFor(picker, /Qatest2\b/i);
  expect(box, 'Qatest2 is offered in the participant picker').not.toBeNull();
  await box!.check();
  await picker
    .getByRole('button', { name: /^Done$/i })
    .first()
    .click();
}

test.describe(
  'KPost Kall · dashboard and schedule failures are reported',
  {
    tag: ['@ui', '@kall', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );

    test('a Kall dashboard load that answers HTTP 500 is reported and the screen stays up @ui', async ({
      page,
    }) => {
      let called = false;
      await page.route(DASHBOARD, (route) => {
        called = true;
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'FAILURE', statusCode: 500, message: '' }),
        });
      });
      const stop = watchUiHealth(page);
      await gotoKall(page);
      await expect.poll(() => called, { message: 'the dashboard load fired on /kall' }).toBe(true);
      await expect(
        page.locator('.kall-layout-shell').first(),
        'the Kall screen renders',
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(BOUNDARY), 'no error boundary').toHaveCount(0);
      expect(stop().pageErrors, 'no uncaught error on a failed dashboard').toEqual([]);
      const told = await userIsTold(page);
      test.info().annotations.push({
        type: 'observed',
        description: told
          ? 'error shown on failed dashboard'
          : 'dashboard failed with NO visible error (indistinguishable from "no calls")',
      });
      expect(told, 'a failed Kall dashboard must tell the user, not show an empty list').toBe(true);
    });

    test('a Kall dashboard load that gets no answer (network failure) is reported @ui', async ({
      page,
    }) => {
      let called = false;
      await page.route(DASHBOARD, (route) => {
        called = true;
        return route.abort('failed');
      });
      await gotoKall(page);
      await expect.poll(() => called, { message: 'the dashboard load fired on /kall' }).toBe(true);
      const told = await userIsTold(page);
      test.info().annotations.push({
        type: 'observed',
        description: told ? 'error shown on network failure' : 'network failure: NO feedback',
      });
      expect(told, 'a dashboard that never loaded must tell the user').toBe(true);
    });

    test('after a failed dashboard load, a reload recovers the Kall screen @ui', async ({
      page,
    }) => {
      let failNext = true;
      await page.route(DASHBOARD, (route) => {
        if (!failNext) return route.continue();
        failNext = false;
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'FAILURE', statusCode: 500, message: '' }),
        });
      });
      await gotoKall(page);
      await expect.poll(() => failNext, { message: 'the failing load was answered' }).toBe(false);
      const recovered = page.waitForResponse(
        (r) => r.url().includes('/kall/kallDashboard') && r.status() === 200,
        { timeout: 45_000 },
      );
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      await recovered;
      await expect(
        page.locator('.kall-layout-shell').first(),
        'the Kall screen renders after the reload',
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(BOUNDARY), 'no error boundary after recovery').toHaveCount(0);
    });

    test('a Kool Kall schedule that answers HTTP 500 is reported and the form stays open @ui', async ({
      page,
    }) => {
      test.skip(
        !testData.victimKpostId || testData.victimKpostId.includes('qa.victim'),
        'needs the 2nd QA account to invite (QA_VICTIM_KPOST_ID)',
      );
      let calls = 0;
      await page.route(SCHEDULE, (route) => {
        calls += 1;
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'FAILURE', statusCode: 500, error: 'Internal' }),
        });
      });
      await gotoKoolKall(page);
      const modal = await openCreateKall(page);
      expect(modal, 'the Create Kool Kall form opens').not.toBeNull();
      await fillMeeting(page, modal!);
      await modal!
        .getByRole('button', { name: /^Submit$/i })
        .first()
        .click();
      await expect.poll(() => calls, { message: 'the schedule request fired' }).toBeGreaterThan(0);
      const told = await userIsTold(page);
      test.info().annotations.push({
        type: 'observed',
        description: told ? 'error shown on HTTP 500' : 'HTTP 500 on schedule: NO visible error',
      });
      expect(told, 'a meeting the server failed to schedule must be reported').toBe(true);
      await expect(modal!, 'the filled form stays open so the user can retry').toBeVisible();
    });

    test('a Kool Kall schedule the server refuses (FAILURE envelope) is reported, not closed as done @ui', async ({
      page,
    }) => {
      test.skip(
        !testData.victimKpostId || testData.victimKpostId.includes('qa.victim'),
        'needs the 2nd QA account to invite (QA_VICTIM_KPOST_ID)',
      );
      let calls = 0;
      await page.route(SCHEDULE, (route) => {
        calls += 1;
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'FAILURE',
            statusCode: 400,
            message: 'Meeting could not be scheduled',
          }),
        });
      });
      await gotoKoolKall(page);
      const modal = await openCreateKall(page);
      expect(modal, 'the Create Kool Kall form opens').not.toBeNull();
      await fillMeeting(page, modal!);
      await modal!
        .getByRole('button', { name: /^Submit$/i })
        .first()
        .click();
      await expect.poll(() => calls, { message: 'the schedule request fired' }).toBeGreaterThan(0);
      const told = await userIsTold(page);
      const stillOpen = await modal!.isVisible().catch(() => false);
      test.info().annotations.push({
        type: 'observed',
        description: `error shown: ${told}; form still open: ${stillOpen}`,
      });
      expect(told, 'a refused meeting must be reported to the user').toBe(true);
      await expect(
        page.locator('.Toastify__toast').filter({ hasText: /Meeting Created Successfully/i }),
        'a refused meeting is never announced as created',
      ).toHaveCount(0);
    });
  },
);
