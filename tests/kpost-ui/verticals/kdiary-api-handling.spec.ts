import type { Page } from '@playwright/test';
import { AUTH_PROFILES } from '@config/auth-profile';
import { scheduleShape } from '@api/definitions/kpost/kdiary/write.api';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { pickReactSelect } from '../support/react-select';
import { toast } from '../support/validation';

/**
 * KDiary (/kdiary, Katchup components/Diary/Diary.js): a create, delete or participant update the
 * server does not answer is reported, and so is a task the server created without giving back its
 * id. Each write is failed in the browser (createEvent, deleteEvent, addparticipants), so nothing
 * the screen sends reaches the server. A test that needs a real task makes it through the API (the
 * browser's own session) and deletes it afterwards.
 */
const ME = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal');

/** Local "YYYY-MM-DDTHH:mm:00", `hoursAhead` from now (the diary works in local time). */
function localAt(hoursAhead: number): string {
  const d = new Date(Date.now() + hoursAhead * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

const as = () => ({ auth: { principal: ME! }, allowLiveWrite: true });

/** Makes a task for today through the API; returns its id (the test fails without one). */
async function createTask(endpoints: EndpointExecutor, title: string): Promise<number> {
  const created = await endpoints.sendTo(
    'kdiary-create-event',
    {
      body: scheduleShape({
        title,
        scheduleStartDateAndTime: localAt(1),
        scheduleEndDateAndTime: localAt(1.5),
      }),
    },
    { label: 'kdiary-api-handling:create', ...as() },
  );
  expect(created.status, 'the task is created for today (setup)').toBeLessThan(300);
  const eventID = (JSON.parse(created.bodyText ?? '{}') as { data?: { eventID?: number } }).data
    ?.eventID;
  expect(eventID, 'the server gave the new task an id (setup)').toBeTruthy();
  return eventID!;
}

async function deleteTask(endpoints: EndpointExecutor, eventID: number | undefined) {
  if (!eventID) return;
  await endpoints
    .sendTo(
      'kdiary-delete-event',
      { body: { eventID } },
      { label: 'kdiary-api-handling:delete', ...as() },
    )
    .catch(() => undefined);
}

async function gotoDiary(page: Page): Promise<void> {
  await page.goto('/kdiary', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
}

/** The task card's status button opens "KDiary Remarks" (with + Add Participants and Delete Task). */
async function openRemarks(page: Page, title: string): Promise<void> {
  await page
    .getByRole('button', { name: `Update remarks for ${title}` })
    .first()
    .click({ timeout: 30_000 });
  await expect(
    page.getByText('KDiary Remarks', { exact: false }).first(),
    'the remarks modal opens',
  ).toBeVisible({ timeout: 10_000 });
}

/** + Add on the Diary panel, every required field filled (the date defaults to today), then Save. */
async function addSchedule(page: Page, title: string): Promise<void> {
  await gotoDiary(page);
  await page
    .getByRole('button', { name: /\+ ?Add/ })
    .first()
    .click();
  await expect(
    page.getByText('KDiary', { exact: true }).first(),
    'the KDiary add form opens',
  ).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder('Enter Title').fill(title);
  await page.getByPlaceholder('Enter Description').fill('QA bench diary schedule (never saved)');
  const times = page.locator('input[type="time"]:visible');
  await times.nth(0).fill('09:00');
  await times.nth(1).fill('10:00');
  await pickReactSelect(
    page
      .locator('.react-select__control')
      .filter({ hasText: /Priority/ })
      .first(),
    'High Priority',
    { page },
  );
  await page.getByRole('button', { name: /^Save$/ }).click();
}

/** Answers createEvent in the browser: SUCCESS with no data, so the screen has no id for the task. */
async function createWithoutId(page: Page): Promise<() => number> {
  let creates = 0;
  await page.route('**/dairySchedule/createEvent**', (route) => {
    creates += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'SUCCESS', statusCode: 200, message: '', data: null }),
    });
  });
  return () => creates;
}

test.describe(
  'KPost KDiary · a failed or incomplete server answer is reported',
  {
    tag: ['@ui', '@kdiary', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.skip(!ME || !testData.kpostId, 'needs the primary QA account (QA_KPOST_ID)');

    test('a schedule the server does not answer is reported', async ({ page }) => {
      let creates = 0;
      await page.route('**/dairySchedule/createEvent**', (route) => {
        creates += 1;
        return route.abort();
      });
      await addSchedule(page, `QA create-fail ${Date.now()}`);
      await expect(toast(page, 'Unable to create schedule.'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
      expect(creates, 'the create was tried (and stopped in the browser)').toBe(1);
    });

    test('a task delete the server does not answer is reported', async ({ page, endpoints }) => {
      test.skip(
        new Date().getHours() >= 22,
        'no time left today to make a task for today right now (needs two hours before midnight)',
      );
      const title = `QA delete-fail ${Date.now()}`;
      const eventID = await createTask(endpoints, title);
      try {
        let deletes = 0;
        await page.route('**/dairySchedule/deleteEvent**', (route) => {
          deletes += 1;
          return route.abort();
        });
        // "Delete this task?" is a native confirm.
        page.on('dialog', (d) => void d.accept().catch(() => undefined));
        await gotoDiary(page);
        await openRemarks(page, title);
        await page
          .getByRole('button', { name: /^Delete Task$/ })
          .first()
          .click();
        await expect(toast(page, 'Unable to delete task.'), 'the user is told').toBeVisible({
          timeout: 10_000,
        });
        expect(deletes, 'the delete was tried (and stopped in the browser)').toBe(1);
      } finally {
        await deleteTask(endpoints, eventID);
      }
    });

    test('a participant update the server does not answer is reported', async ({
      page,
      endpoints,
    }) => {
      test.skip(
        new Date().getHours() >= 22,
        'no time left today to make a task for today right now (needs two hours before midnight)',
      );
      const title = `QA participants-fail ${Date.now()}`;
      const eventID = await createTask(endpoints, title);
      try {
        let updates = 0;
        await page.route('**/dairySchedule/addparticipants**', (route) => {
          updates += 1;
          return route.abort();
        });
        await gotoDiary(page);
        await openRemarks(page, title);
        await page
          .getByRole('button', { name: /\+?\s*Add Participants/i })
          .first()
          .click();
        const picker = page
          .locator('.modal-dialog')
          .filter({ has: page.locator('.Done-button') })
          .last();
        // Contact rows carry `name="Contact <n>"` (Select All is `.selectAll_check`).
        const contact = picker
          .locator('input[type="checkbox"][name^="Contact "]:not([disabled])')
          .first();
        await expect(contact, 'a contact is offered').toBeVisible({ timeout: 15_000 });
        await contact.check();
        await picker.locator('.Done-button').last().click();
        await expect(
          toast(page, 'Unable to update participants.'),
          'the user is told the participants were not saved',
        ).toBeVisible({ timeout: 10_000 });
        expect(updates, 'the update was tried (and stopped in the browser)').toBe(1);
      } finally {
        await deleteTask(endpoints, eventID);
      }
    });

    test('a task created without an id cannot take participants, and says so', async ({ page }) => {
      const creates = await createWithoutId(page);
      let updates = 0;
      await page.route('**/dairySchedule/addparticipants**', (route) => {
        updates += 1;
        return route.abort();
      });
      const title = `QA no-id ${Date.now()}`;
      await addSchedule(page, title);
      // The id-less task is listed from the screen's own copy (the server never saw it).
      await openRemarks(page, title);
      await page
        .getByRole('button', { name: /\+?\s*Add Participants/i })
        .first()
        .click();
      await expect(
        toast(page, 'Unable to identify event for participant update.'),
        'the user is told the task cannot be identified',
      ).toBeVisible({ timeout: 10_000 });
      expect(creates(), 'the create was answered in the browser').toBe(1);
      expect(updates, 'no participant update was sent').toBe(0);
    });

    test('a task created without an id cannot be deleted, and says so', async ({ page }) => {
      const creates = await createWithoutId(page);
      let deletes = 0;
      await page.route('**/dairySchedule/deleteEvent**', (route) => {
        deletes += 1;
        return route.abort();
      });
      page.on('dialog', (d) => void d.accept().catch(() => undefined));
      const title = `QA no-id ${Date.now()}`;
      await addSchedule(page, title);
      await openRemarks(page, title);
      await page
        .getByRole('button', { name: /^Delete Task$/ })
        .first()
        .click();
      await expect(
        toast(page, 'Unable to identify event for delete.'),
        'the user is told the task cannot be identified',
      ).toBeVisible({ timeout: 10_000 });
      expect(creates(), 'the create was answered in the browser').toBe(1);
      expect(deletes, 'no delete was sent').toBe(0);
    });
  },
);
