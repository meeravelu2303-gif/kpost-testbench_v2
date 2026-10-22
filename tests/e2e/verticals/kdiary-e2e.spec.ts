import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { requireKpostDb, rowSummary, rowWhen } from '../support/cross-layer';
import { pickReactSelect } from '../support/react-select';

/**
 * **KDiary through the screens** — the module had NO working UI coverage: the old `kdiary.spec.ts` is
 * hard-skipped citing "`/kdiary` is commented out / no entry point (#812)", but that is out of date —
 * `/kdiary` is now routed (`MenuRoutes.js:442` → `<KDiary/>` → `Diary`), reachable in the deployed
 * build (verified live 2026-10-15), and #812 does not exist in Bugzilla. The Diary panel shows a
 * day filter, a task %/count, the schedule list, and a "+ Add" button opening the "KDiary" modal
 * (Add Schedule / Add Report).
 *
 * This drives the core user action end to end: open the modal, create a one-time schedule, confirm it
 * lands in the list (and the server accepted it via CreateDiarySchedule), then delete it through the
 * task's remarks modal (window.confirm "Delete this task?") so nothing is left on the account.
 *
 * Required fields for a one-time schedule (Diary.js validateForm): Title, Description, Date (prefilled
 * today), Start Time, End Time, Priority — Save stays disabled until all are set. Priority is a
 * react-select. Gated behind KDIARY_UI_LIFECYCLE (it writes a real schedule) and self-cleaning.
 */
test.describe(
  'KPost KDiary · create and delete a schedule @ui',
  { tag: ['@ui', '@verticals', '@regression'] },
  () => {
    test.describe.configure({ timeout: 150_000 });
    test.skip(
      process.env.KDIARY_UI_LIFECYCLE !== 'true',
      'creates a real diary schedule; set KDIARY_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    const waitLoaded = (page: Page) =>
      page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

    test(
      'a one-time schedule can be created from the Diary panel and then deleted @ui',
      {
        tag: '@sanity',
        annotation: [
          {
            type: 'cross-layer',
            description:
              'KDiary: create + delete on screen → createEvent / deleteEvent → TBL_KPOST_KDIARY_SCHEDULE',
          },
        ],
      },
      async ({ page, databases }) => {
        const db = requireKpostDb(databases);
        const title = `QA KDiary ${Date.now()}`;
        type ScheduleRow = {
          event_id: unknown;
          title: unknown;
          created_by: unknown;
          delete_by_sender: unknown;
        };
        const scheduleRow = (ok: (r: ScheduleRow | undefined) => boolean, message: string) =>
          rowWhen<ScheduleRow>(
            db,
            'SELECT event_id, title, created_by, delete_by_sender FROM TBL_KPOST_KDIARY_SCHEDULE WHERE title = ? ORDER BY event_id DESC',
            [title],
            ok,
            message,
          );

        // Accept the native "Delete this task?" confirm when it fires (cleanup step).
        page.on('dialog', (d) => void d.accept().catch(() => undefined));

        await page.goto('/kdiary', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await waitLoaded(page);
        await expect(
          page.getByText('Diary', { exact: true }).first(),
          'the Diary panel renders',
        ).toBeVisible({ timeout: 20_000 });

        let created = false;
        try {
          // --- Open the Add modal and fill the schedule ---------------------------------------
          await page
            .getByRole('button', { name: /\+ ?Add/ })
            .first()
            .click();
          await expect(
            page.getByText('KDiary', { exact: true }).first(),
            'the KDiary add modal opens',
          ).toBeVisible({ timeout: 10_000 });
          await page.getByPlaceholder('Enter Title').fill(title);
          await page.getByPlaceholder('Enter Description').fill('QA bench diary schedule');
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

          // --- Save: the server must accept it ------------------------------------------------
          const createResp = page
            .waitForResponse((r) => r.url().includes('/dairySchedule/createEvent'), {
              timeout: 20_000,
            })
            .catch(() => null);
          const save = page.getByRole('button', { name: /^Save$/ });
          await expect(save, 'Save enables once every required field is set').toBeEnabled({
            timeout: 10_000,
          });
          await save.click();
          const cr = await createResp;
          test.info().annotations.push({
            type: 'observed',
            description: `create: ${cr ? `HTTP ${cr.status()}` : 'no CreateDiarySchedule request seen'}`,
          });
          expect(cr, 'a CreateDiarySchedule request is sent').not.toBeNull();
          expect(cr!.status(), 'the schedule is accepted by the server').toBeLessThan(300);

          // Layer 3: the schedule row exists, owned by the signed-in account.
          const stored = await scheduleRow(
            (r) => r !== undefined,
            'TBL_KPOST_KDIARY_SCHEDULE holds the new schedule (by its title)',
          );
          test.info().annotations.push({
            type: 'observed',
            description: `row after create: ${rowSummary(stored, ['event_id', 'title', 'created_by', 'delete_by_sender'])}`,
          });
          expect(
            String(stored?.created_by),
            'the schedule belongs to the account that made it',
          ).toBe(testData.kpostId);

          // --- It lands in the day's schedule list --------------------------------------------
          const taskRow = page.getByText(title, { exact: false }).first();
          await expect(taskRow, 'the new schedule appears in the Diary list').toBeVisible({
            timeout: 20_000,
          });
          created = true;
          const shot = test.info().outputPath('kdiary-created.png');
          await page.screenshot({ path: shot });
          await test.info().attach('kdiary-created', { path: shot, contentType: 'image/png' });

          // --- Delete it: each card's right-side status button (aria-label "Update remarks for <title>")
          //     opens the "KDiary Remarks" modal with a "Delete Task" button (handleDeleteTask →
          //     window.confirm "Delete this task?" → DeleteDiaryScheduleEvent).
          await page
            .getByRole('button', { name: `Update remarks for ${title}` })
            .first()
            .click();
          await expect(
            page.getByText('KDiary Remarks', { exact: false }).first(),
            'the remarks modal opens',
          ).toBeVisible({ timeout: 10_000 });
          const delResp = page
            .waitForResponse((r) => r.url().includes('/dairySchedule/deleteEvent'), {
              timeout: 15_000,
            })
            .catch(() => null);
          const delBtn = page.getByRole('button', { name: /Delete Task/i }).first();
          await expect(delBtn, 'the task offers a Delete Task button').toBeVisible({
            timeout: 10_000,
          });
          await delBtn.click();
          const dr = await delResp;
          test.info().annotations.push({
            type: 'observed',
            description: `delete: ${dr ? `HTTP ${dr.status()}` : 'no delete request seen'}`,
          });
          expect(dr, 'a delete request is sent').not.toBeNull();
          expect(dr!.status(), 'the delete is accepted').toBeLessThan(300);
          await expect(
            page.getByText(title, { exact: false }),
            'the deleted schedule is gone from the Diary list',
          ).toHaveCount(0, { timeout: 15_000 });
          created = false;

          // Layer 3: the delete reached the row — removed, or flagged as deleted by its owner.
          const gone = await scheduleRow(
            (r) =>
              r === undefined ||
              ['1', 'y', 'yes', 'true'].includes(String(r.delete_by_sender).toLowerCase()),
            'after Delete Task the schedule row is removed or flagged delete_by_sender',
          );
          test.info().annotations.push({
            type: 'observed',
            description: `row after delete: ${rowSummary(gone, ['event_id', 'delete_by_sender'])}`,
          });
        } finally {
          // Safety net: if an assertion failed after the schedule was created, remove it via the UI.
          if (created) {
            const cleanup = page
              .waitForResponse((r) => r.url().includes('/dairySchedule/deleteEvent'), {
                timeout: 15_000,
              })
              .catch(() => null);
            await page
              .getByRole('button', { name: `Update remarks for ${title}` })
              .first()
              .click()
              .catch(() => undefined);
            await page
              .getByRole('button', { name: /Delete Task/i })
              .first()
              .click()
              .catch(() => undefined);
            await cleanup;
          }
        }
      },
    );
  },
);
