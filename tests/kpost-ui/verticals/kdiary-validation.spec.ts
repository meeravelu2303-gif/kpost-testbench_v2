import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { pickReactSelect } from '../support/react-select';

/**
 * KDiary (/kdiary) › + Add refuses an incomplete or impossible schedule (Katchup Diary.js
 * validateForm: Title, Description, Date, Start/End Time and Priority are required) and sends a
 * complete one. createEvent is blocked at the network, so nothing is ever created.
 */

const CREATE_EVENT = '**/dairySchedule/createEvent**';

/** Blocks createEvent; returns the bodies the screen tried to send. */
async function blockCreate(page: Page): Promise<Array<Record<string, unknown>>> {
  const sent: Array<Record<string, unknown>> = [];
  await page.route(CREATE_EVENT, (route) => {
    sent.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
    return route.abort();
  });
  return sent;
}

async function openAddForm(page: Page) {
  await page.goto('/kdiary', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  await page
    .getByRole('button', { name: /\+ ?Add/ })
    .first()
    .click();
  await expect(
    page.getByText('KDiary', { exact: true }).first(),
    'the KDiary add form opens',
  ).toBeVisible({ timeout: 15_000 });
  const times = page.locator('input[type="time"]:visible');
  return {
    title: page.getByPlaceholder('Enter Title'),
    description: page.getByPlaceholder('Enter Description'),
    start: times.nth(0),
    end: times.nth(1),
    priority: page
      .locator('.react-select__control')
      .filter({ hasText: /Priority/ })
      .first(),
    save: page.getByRole('button', { name: /^Save$/ }),
  };
}

type Form = Awaited<ReturnType<typeof openAddForm>>;

/** Fills every field (the date defaults to today) with the given values. */
async function fill(
  page: Page,
  form: Form,
  values: { title: string; description: string; start: string; end: string },
): Promise<void> {
  await form.title.fill(values.title);
  await form.description.fill(values.description);
  await form.start.fill(values.start);
  await form.end.fill(values.end);
  await pickReactSelect(form.priority, 'High Priority', { page });
}

test.describe(
  'KPost KDiary · Add refuses an incomplete or impossible schedule',
  { tag: ['@ui', '@verticals', '@regression'] },
  () => {
    test.skip(!testData.kpostId, 'needs the primary QA account (QA_KPOST_ID)');

    test('Save stays disabled until title, description, times and priority are set', async ({
      page,
    }) => {
      const sent = await blockCreate(page);
      const form = await openAddForm(page);
      await expect(form.save, 'an empty schedule cannot be saved').toBeDisabled();
      await form.title.fill('QA validation');
      await expect(form.save, 'a title alone is not enough').toBeDisabled();
      await form.start.fill('09:00');
      await form.end.fill('10:00');
      await expect(form.save, 'no priority yet: still disabled').toBeDisabled();
      await pickReactSelect(form.priority, 'High Priority', { page });
      await form.description.fill('QA bench');
      await expect(form.save, 'every required field set: Save enables').toBeEnabled();
      expect(sent, 'nothing was sent while the form was incomplete').toHaveLength(0);
    });

    test('a schedule with no description cannot be saved, and the user is told why', async ({
      page,
    }) => {
      const sent = await blockCreate(page);
      const form = await openAddForm(page);
      await fill(page, form, {
        title: 'QA validation',
        description: '',
        start: '09:00',
        end: '10:00',
      });
      await expect(form.save, 'Save stays disabled without a description').toBeDisabled();
      await expect(
        page.getByText(/Description is required/i).first(),
        'the user is told the description is missing',
      ).toBeVisible({ timeout: 10_000 });
      expect(sent, 'a schedule with no description never reaches the server').toHaveLength(0);
    });

    test('a title of only spaces is refused and never sent', async ({ page }) => {
      const sent = await blockCreate(page);
      const form = await openAddForm(page);
      await fill(page, form, {
        title: '   ',
        description: 'QA bench',
        start: '09:00',
        end: '10:00',
      });
      await form.save.click();
      await expect(
        page.getByText('Title is required', { exact: true }).first(),
        'the user is told the title is missing',
      ).toBeVisible({ timeout: 10_000 });
      expect(sent, 'a blank title never reaches the server').toHaveLength(0);
    });

    test('an end time before the start time is refused and never sent', async ({ page }) => {
      const sent = await blockCreate(page);
      const form = await openAddForm(page);
      await fill(page, form, {
        title: 'QA validation',
        description: 'QA bench',
        start: '11:00',
        end: '10:00',
      });
      await form.save.click();
      await expect(
        page.getByText(/End time (must|should) be (after|later than) (the )?start/i).first(),
        'the user is told the end is before the start',
      ).toBeVisible({ timeout: 10_000 });
      expect(sent, 'a schedule that ends before it starts never reaches the server').toHaveLength(
        0,
      );
    });

    test('a complete schedule is sent as typed', async ({ page }) => {
      const sent = await blockCreate(page);
      const form = await openAddForm(page);
      const title = `QA validation ${Date.now()}`;
      await fill(page, form, { title, description: 'QA bench', start: '09:00', end: '10:00' });
      await form.save.click();
      await expect
        .poll(() => sent.length, { message: 'the schedule is sent', timeout: 10_000 })
        .toBe(1);
      expect(sent[0]?.title, 'the title is sent as typed').toBe(title);
      expect(
        Number(sent[0]?.scheduleEndDateAndTime) - Number(sent[0]?.scheduleStartDateAndTime),
        'one hour between start and end',
      ).toBe(3_600_000);
    });
  },
);
