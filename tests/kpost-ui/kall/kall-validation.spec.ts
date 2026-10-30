import type { Locator, Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { gotoKoolKall, meetingTitleField, openCreateKall } from '../support/kall';
import { checkboxFor } from '../support/pickers';

/**
 * Kool Kall › Create refuses an incomplete or impossible meeting (CreateKallModal.js): Submit stays
 * disabled until title, date, both times and a participant are set, a start time already past is
 * refused, and an end time before the start is refused. scheduledKall is blocked at the network, so
 * a meeting the screen wrongly lets through is counted, never created.
 */

const SCHEDULE = '**/kall/scheduledKall**';

const localDay = (offsetDays: number): string => {
  const d = new Date(Date.now() + offsetDays * 24 * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Blocks scheduledKall and returns how many times the screen tried to send it. */
async function blockSchedule(page: Page): Promise<() => number> {
  let attempts = 0;
  await page.route(SCHEDULE, (route) => {
    attempts += 1;
    return route.abort();
  });
  return () => attempts;
}

async function inviteSecondAccount(page: Page, modal: Locator): Promise<void> {
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

/** Fills the whole form for one meeting on `day`, from `from` to `to` (HH:MM), with Qatest2 invited. */
async function fillMeeting(page: Page, modal: Locator, day: string, from: string, to: string) {
  await meetingTitleField(modal).fill(`QA validation ${Date.now()}`);
  await modal.locator('input[name="birthday"]').first().fill(day);
  const times = modal.locator('input[type="time"]');
  await times.nth(0).fill(from);
  await times.nth(1).fill(to);
  await inviteSecondAccount(page, modal);
}

const submit = (modal: Locator): Locator =>
  modal.getByRole('button', { name: /^Submit$/i }).first();

test.describe(
  'Kall · Create Kool Kall refuses an incomplete or impossible meeting',
  { tag: ['@ui', '@kall', '@regression'] },
  () => {
    test.skip(!testData.victimKpostId, 'needs the 2nd QA account (QA_VICTIM_KPOST_ID)');

    test('Submit stays disabled until title, date, both times and a participant are set', async ({
      page,
    }) => {
      const attempts = await blockSchedule(page);
      await gotoKoolKall(page);
      const modal = await openCreateKall(page);
      expect(modal, 'the Create Kool Kall form opens').not.toBeNull();
      await expect(submit(modal!), 'an empty form cannot be submitted').toBeDisabled();
      await meetingTitleField(modal!).fill(`QA validation ${Date.now()}`);
      await expect(submit(modal!), 'a title alone is not enough').toBeDisabled();
      await modal!.locator('input[name="birthday"]').first().fill(localDay(1));
      const times = modal!.locator('input[type="time"]');
      await times.nth(0).fill('10:00');
      await times.nth(1).fill('10:30');
      await expect(submit(modal!), 'no participant yet: still disabled').toBeDisabled();
      await inviteSecondAccount(page, modal!);
      await expect(submit(modal!), 'a complete meeting can be submitted').toBeEnabled();
      expect(attempts(), 'nothing was sent while the form was incomplete').toBe(0);
    });

    test('a start time that has already passed is refused', async ({ page }) => {
      test.skip(
        new Date().getHours() < 1,
        'no past start time is available right now (needs an hour of today behind us)',
      );
      const attempts = await blockSchedule(page);
      await gotoKoolKall(page);
      const modal = await openCreateKall(page);
      expect(modal, 'the Create Kool Kall form opens').not.toBeNull();
      await fillMeeting(page, modal!, localDay(0), '00:05', '00:35');
      await submit(modal!).click();
      await expect(
        page.getByText(/From Time cannot be in the past/i).first(),
        'the user is told the start has passed',
      ).toBeVisible({ timeout: 10_000 });
      expect(attempts(), 'a meeting in the past is never sent').toBe(0);
    });

    test('an end time before the start time is refused', async ({ page }) => {
      const attempts = await blockSchedule(page);
      await gotoKoolKall(page);
      const modal = await openCreateKall(page);
      expect(modal, 'the Create Kool Kall form opens').not.toBeNull();
      await fillMeeting(page, modal!, localDay(1), '11:00', '10:00');
      await submit(modal!).click();
      await expect(
        page.getByText(/To Time must be after the From Time/i).first(),
        'the user is told the end is before the start',
      ).toBeVisible({ timeout: 10_000 });
      expect(attempts(), 'a meeting that ends before it starts is never sent').toBe(0);
    });
  },
);
