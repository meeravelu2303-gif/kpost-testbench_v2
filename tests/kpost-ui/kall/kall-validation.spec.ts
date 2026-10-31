import type { Locator, Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  button,
  endMeeting,
  gotoKoolKall,
  meetingTitleField,
  openCreateKall,
  openMeeting,
  scheduleMeeting,
} from '../support/kall';
import { openDigitalCard } from '../support/contacts';
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
        page
          .getByText('The To Time must be after the From Time. Please adjust the timings.', {
            exact: true,
          })
          .first(),
        'the user is told the end is before the start',
      ).toBeVisible({ timeout: 10_000 });
      expect(attempts(), 'a meeting that ends before it starts is never sent').toBe(0);
    });

    test('an end time that has already passed is refused', async ({ page }) => {
      const hour = new Date().getHours();
      test.skip(
        hour < 1 || hour > 21,
        'no past end time with a future start time is available right now (needs 01:00–21:59)',
      );
      const attempts = await blockSchedule(page);
      await gotoKoolKall(page);
      const modal = await openCreateKall(page);
      expect(modal, 'the Create Kool Kall form opens').not.toBeNull();
      // A start still ahead today, an end at 00:05 (already gone): the end is checked as past first.
      await fillMeeting(
        page,
        modal!,
        localDay(0),
        `${String(hour + 2).padStart(2, '0')}:00`,
        '00:05',
      );
      await submit(modal!).click();
      await expect(
        page
          .getByText('The To Time cannot be in the past. Please select a valid time.', {
            exact: true,
          })
          .first(),
        'the user is told the end has passed',
      ).toBeVisible({ timeout: 10_000 });
      expect(attempts(), 'a meeting ending in the past is never sent').toBe(0);
    });

    test('editing a meeting refuses an end before the start and times in the past', async ({
      page,
      endpoints,
    }) => {
      test.skip(
        process.env.KALL_UI_LIFECYCLE !== 'true',
        'schedules a real meeting to edit (ended afterwards); set KALL_UI_LIFECYCLE=true',
      );
      const subject = `QA edit validation ${Date.now()}`;
      let kallID: number | undefined;
      let edits = 0;
      await page.route('**/kall/reScheduleKall**', (route) => {
        edits += 1;
        return route.abort();
      });
      try {
        kallID = await scheduleMeeting(endpoints, subject, 3 * 3_600_000, [testData.victimKpostId]);
        const modal = await openMeeting(page, subject);
        await button(modal, 'Edit Kall').click();
        const editor = page
          .getByRole('dialog')
          .filter({ hasText: /Edit Kool Kall/i })
          .last();
        await expect(editor, 'the Edit Kool Kall form opens').toBeVisible({ timeout: 15_000 });
        const times = editor.locator('input[type="time"]');
        const save = button(editor, /^(Submit|Update|Save)$/i);

        /** Refused either way the screen chooses: Submit stays off, or Submit names the rule. */
        const expectRefused = async (rule: string, what: string) => {
          if (await save.isEnabled()) {
            await save.click();
            await expect(
              page.getByText(rule, { exact: true }).first(),
              `${what} is refused with "${rule}"`,
            ).toBeVisible({ timeout: 10_000 });
          } else {
            await expect(save, `${what}: Submit stays disabled`).toBeDisabled();
          }
        };

        const [h] = (await times.nth(0).inputValue()).split(':').map(Number);
        await times.nth(1).fill(`${String(h ?? 12).padStart(2, '0')}:00`);
        await times.nth(0).fill(`${String(h ?? 12).padStart(2, '0')}:30`);
        await expectRefused('Start time must be before the end time.', 'an end before the start');

        await editor
          .locator('input[type="date"], input[name="birthday"]')
          .first()
          .fill(localDay(-1));
        await times.nth(0).fill('10:00');
        await times.nth(1).fill('11:00');
        await expectRefused(
          'Start and End times cannot be in the past. Please select valid times.',
          'a meeting moved into the past',
        );
        expect(edits, 'no refused edit reaches the server').toBe(0);
      } finally {
        await endMeeting(endpoints, [kallID]);
      }
    });

    test('calling a blocked contact is refused', async ({ page, endpoints, databases }) => {
      test.skip(
        process.env.KALL_UI_LIFECYCLE !== 'true',
        'blocks a QA contact for the test (restored after); set KALL_UI_LIFECYCLE=true',
      );
      // qatest2: the browser account's one active QA contact (the Contacts flows keep it so).
      const target = testData.victimKpostId;
      const db = databases.for('kpost-api');
      const before = db.enabled
        ? await db.findOne<{ is_blocked: number }>({
            table: 'TBL_KPOST_USER_CONTACTS',
            where: { kpost_id: testData.kpostId, contact_id: target },
          })
        : undefined;
      test.skip(
        !before || Number((before as { delete_status?: number }).delete_status) === 1,
        'needs the 2nd QA account in the browser account’s contacts (provision it)',
      );
      const block = (isBlocked: boolean, label: string) =>
        endpoints.sendTo(
          'contacts-block',
          { body: { contactID: target, isBlocked } },
          { label: `kall-validation:${label}`, allowLiveWrite: true, ownedIdentifiers: [target] },
        );
      let calls = 0;
      const callUrls: string[] = [];
      // Only starting a Kall is stopped (and counted); reads such as kallDashboard go through.
      await page.route(
        (url) => /\/kall\/(initiateKall|kallRequest|startKall|makeKall)/i.test(url.pathname),
        (route) => {
          calls += 1;
          callUrls.push(new URL(route.request().url()).pathname);
          return route.abort();
        },
      );
      try {
        // Block as a user does (Digital Card › Block Contact): the app keeps its own contact list,
        // so a block made only through the API is not seen by an open session.
        const card = await openDigitalCard(page, 'qatest2');
        await card.getByRole('button', { name: 'Block Contact', exact: true }).click();
        await page
          .locator('.modal-dialog', { hasText: 'Block Contact' })
          .last()
          .getByRole('button', { name: /^Block$/ })
          .click();
        // Into Kall within the app, as a user does from the menu: a reload would rebuild its list.
        await page.evaluate(() => {
          window.history.pushState({}, '', '/kall');
          window.dispatchEvent(new PopStateEvent('popstate'));
        });
        await page.getByRole('tab', { name: 'Contacts' }).first().click({ timeout: 15_000 });
        await page
          .getByRole('searchbox')
          .last()
          .fill('qatest2')
          .catch(() => undefined);
        const row = page
          .locator('.contactBar_Dropdown')
          .filter({ hasText: /Qatest2/i })
          .first();
        await row.locator('svg').last().click({ timeout: 15_000 });
        const stored = await db.findOne<{ is_blocked: number }>({
          table: 'TBL_KPOST_USER_CONTACTS',
          where: { kpost_id: testData.kpostId, contact_id: target },
        });
        expect(Number(stored?.is_blocked), 'the block from the card was saved (setup)').toBe(1);
        await page.locator('.icon-KP_240-Kall01').first().click({ timeout: 15_000 });
        await expect
          .soft(
            page.getByText('User is Blocked. Unblock to make Kall', { exact: true }).first(),
            'the user is told the contact is blocked',
          )
          .toBeVisible({ timeout: 10_000 });
        expect(
          calls,
          `no Kall is started to a blocked contact (tried: ${callUrls.join(', ')})`,
        ).toBe(0);
      } finally {
        if (!before?.is_blocked) await block(false, 'restore');
      }
    });
    test('a call history that fails to load is reported', async ({ page }) => {
      // KallHistory.js: when kall/kallInfo fails, the history pane says so instead of staying blank.
      await page.route('**/kall/kallInfo**', (route) => route.abort());
      await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.getByRole('tab', { name: 'Contacts' }).first().click({ timeout: 15_000 });
      await page
        .getByRole('searchbox')
        .last()
        .fill('qatest2')
        .catch(() => undefined);
      await page
        .locator('.contactBar_Dropdown')
        .filter({ hasText: /Qatest2/i })
        .first()
        .getByText(/^qatest2 bench$/i)
        .first()
        .click({ timeout: 15_000 });
      await expect(
        page
          .locator('.Toastify__toast')
          .filter({ hasText: 'No Call History found for this Contact' })
          .first(),
        'the user is told the history could not be loaded',
      ).toBeVisible({ timeout: 15_000 });
    });

    test('a meeting whose end time has passed cannot be opened', async ({ page, endpoints }) => {
      test.skip(
        process.env.KALL_UI_LIFECYCLE !== 'true',
        'schedules a real meeting (ended afterwards); set KALL_UI_LIFECYCLE=true',
      );
      const subject = `QA ended meeting ${Date.now()}`;
      let kallID: number | undefined;
      try {
        // Three hours ahead on the server; the browser's clock is then moved four hours on, so to
        // the screen (which compares with the browser clock) the meeting is already over.
        kallID = await scheduleMeeting(endpoints, subject, 3 * 3_600_000, [testData.victimKpostId]);
        await page.clock.install({ time: new Date(Date.now() + 4 * 3_600_000) });
        await gotoKoolKall(page);
        await page.getByText(subject).first().click({ timeout: 30_000 });
        await expect(
          page.locator('.Toastify__toast').filter({ hasText: 'Meeting Has Ended' }).first(),
          'the user is told the meeting has ended',
        ).toBeVisible({ timeout: 10_000 });
      } finally {
        await endMeeting(endpoints, [kallID]);
      }
    });
  },
);
