import type { Locator, Page, Response } from '@playwright/test';
import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';
import { STORAGE_STATE_2, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { gotoKoolKall } from '../support/kall';
import { checkboxFor } from '../support/pickers';
import { openSession, requireAccounts, requireFlags } from '../journeys/support/journey';

/**
 * Kool Kall, every step after scheduling, on screen (KoolKallModal.js): the host copies the meeting
 * link, edits it (reScheduleKall), changes the participants (modifyKallMembers) and cancels it
 * (updateKallStatus 2); an invitee accepts (10), declines with a reason (4), and once the meeting has
 * started marks "Not Join" with a reason (11) while the host joins. Each test schedules its own
 * meeting through the API as A (in a browser project the API reuses A's browser session, so A stays
 * signed in) and ends it afterwards. Each server answer is checked, not just the screen.
 */

const HOUR = 3_600_000;

/** The kallID in a scheduledKall / reScheduleKall reply. */
function kallIdOf(body: unknown): number | undefined {
  const root = (body ?? {}) as Record<string, unknown>;
  const data = root.data;
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  const obj =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  for (const candidate of [obj?.kallID, obj?.id, row?.kallID, row?.id, root.kallID]) {
    if (typeof candidate === 'number') return candidate;
  }
  return undefined;
}

async function schedule(
  endpoints: EndpointExecutor,
  subject: string,
  startInMs: number,
  invitees: string[],
): Promise<number> {
  const start = Date.now() + startInMs;
  const scheduled = await endpoints.sendTo(
    'kall-scheduled',
    {
      body: scheduleShape({
        subject,
        scheduledStartTime: start,
        scheduledEndTime: start + 30 * 60_000,
        kallDetails: invitees.map((receiver) => ({ receiver })),
      }),
    },
    { label: 'kool-kall-e2e:schedule', allowLiveWrite: true },
  );
  expect(scheduled.status, 'the meeting is scheduled (setup)').toBeLessThan(300);
  const json = scheduled.json();
  const kallID = kallIdOf(json.ok ? json.value : undefined);
  expect(kallID, 'the scheduled meeting has an id (setup)').toBeTruthy();
  return kallID!;
}

async function endMeeting(endpoints: EndpointExecutor, kallIDs: Array<number | undefined>) {
  for (const kallID of new Set(kallIDs.filter((id): id is number => typeof id === 'number'))) {
    // `kallID` alone: sending `id` too makes endKoolKall answer 500.
    await endpoints
      .sendTo(
        'kall-end-kool',
        { body: { kallID } },
        { label: 'kool-kall-e2e:end', allowLiveWrite: true },
      )
      .catch(() => undefined);
  }
}

/** Opens the meeting's dialog from Kall › Kool Kall (or Kall › Recents, today's meetings). */
async function openMeeting(page: Page, title: string, from: 'kool' | 'recents' = 'kool') {
  if (from === 'kool') {
    await gotoKoolKall(page);
  } else {
    await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .getByRole('tab', { name: /Recents/i })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => undefined);
  }
  await page.getByText(title).first().click({ timeout: 30_000 });
  const modal = page.getByRole('dialog').filter({ hasText: title }).last();
  await expect(modal, `the "${title}" meeting opens`).toBeVisible({ timeout: 20_000 });
  return modal;
}

/** The next updateKallStatus answer and the kallStatus the screen sent with it. */
async function statusUpdate(page: Page, act: () => Promise<void>) {
  const answer = page.waitForResponse((r) => r.url().includes('/kall/updateKallStatus'), {
    timeout: 30_000,
  });
  await act();
  const response = await answer;
  const sent = JSON.parse(response.request().postData() ?? '{}') as { kallStatus?: number };
  return { response, kallStatus: sent.kallStatus, body: await bodyOf(response) };
}

async function bodyOf(response: Response): Promise<{ status?: string; statusCode?: number }> {
  return (await response.json().catch(() => ({}))) as { status?: string; statusCode?: number };
}

function button(scope: Locator, name: string | RegExp): Locator {
  return scope
    .getByRole('button', { name: typeof name === 'string' ? new RegExp(`^${name}$`, 'i') : name })
    .first();
}

test.describe(
  'Kall · Kool Kall lifecycle on screen @ui',
  { tag: [TAGS.ui, TAGS.kall, TAGS.regression] },
  () => {
    test.describe.configure({ mode: 'default', timeout: 300_000 });
    requireAccounts('A', 'B');
    requireFlags('KALL_UI_LIFECYCLE');

    test('the host copies the link, edits the meeting, changes its participants and cancels it', async ({
      page,
      endpoints,
    }) => {
      const title = `QA kool host ${Date.now()}`;
      const ids: Array<number | undefined> = [];
      ids.push(await schedule(endpoints, title, 24 * HOUR, [testData.victimKpostId]));
      const current = title;

      try {
        await test.step('the meeting link opens on this site, and Copy copies it', async () => {
          const modal = await openMeeting(page, current);
          const origin = new URL(page.url()).origin;
          const shown = modal.getByText(/\/koolkall\//).first();
          await expect.soft(shown, 'the meeting link is shown').toBeVisible({ timeout: 10_000 });
          const link = ((await shown.textContent().catch(() => '')) ?? '').trim();
          // An invitee who opens the link must land on the deployment the meeting was made on.
          expect
            .soft(link, `the meeting link points to this site (${origin})`)
            .toMatch(new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/koolkall/`));
          // Browsers expose the clipboard only on https pages; on an http test host Copy cannot work.
          if (await page.evaluate(() => window.isSecureContext)) {
            await page
              .context()
              .grantPermissions(['clipboard-read', 'clipboard-write'])
              .catch(() => undefined);
            await modal.getByText('Copy', { exact: true }).first().click();
            const copied = await page
              .evaluate(() => navigator.clipboard.readText())
              .catch(() => '');
            expect.soft(copied, 'Copy puts the shown link on the clipboard').toBe(link);
          } else {
            test.info().annotations.push({
              type: 'not-checked',
              description: `Copy: ${origin} is not https, so the browser offers no clipboard`,
            });
          }
          await page.keyboard.press('Escape');
        });

        await test.step('Edit Kall moves the end time (reScheduleKall)', async () => {
          const modal = await openMeeting(page, current);
          await button(modal, 'Edit Kall').click();
          const editor = page
            .getByRole('dialog')
            .filter({ hasText: /Edit Kool Kall/i })
            .last();
          await expect(editor, 'the Edit Kool Kall form opens').toBeVisible({ timeout: 15_000 });
          // The title is read-only when editing (CreateKallModal: isDisabled={isEditKoolKall}).
          await expect
            .soft(editor.locator('input[placeholder="Enter Meeting Title"]').first())
            .toBeDisabled();
          const to = editor.locator('input[type="time"]').nth(1);
          const [hours, minutes] = (await to.inputValue()).split(':').map(Number);
          const later = ((hours ?? 0) * 60 + (minutes ?? 0) + 15) % (24 * 60);
          const newEnd = `${String(Math.floor(later / 60)).padStart(2, '0')}:${String(later % 60).padStart(2, '0')}`;
          await to.fill(newEnd);
          const saved = page.waitForResponse((r) => r.url().includes('/kall/reScheduleKall'), {
            timeout: 30_000,
          });
          await button(editor, /^(Submit|Update|Save)$/i).click();
          const response = await saved;
          const body = await bodyOf(response);
          ids.push(kallIdOf(body));
          expect.soft(response.status(), 'the server accepts the edit').toBeLessThan(300);
          expect.soft(body.status, 'and reports SUCCESS').toBe('SUCCESS');
          await gotoKoolKall(page);
          await expect
            .soft(page.getByText(current).first(), 'the edited meeting is still listed')
            .toBeVisible({ timeout: 30_000 });
        });

        await test.step('Add / Remove Members invites a third person (modifyKallMembers)', async () => {
          const modal = await openMeeting(page, current);
          await button(modal, /Add \/ Remove Members/i).click();
          const picker = page
            .getByRole('dialog')
            .filter({ hasText: /Invite Participants/i })
            .last();
          await expect(picker, 'the participant picker opens').toBeVisible({ timeout: 15_000 });
          const third = await checkboxFor(picker, /qatest3\b/i);
          expect(third, 'the third QA account is offered').not.toBeNull();
          await third!.check();
          const changed = page.waitForResponse((r) => r.url().includes('/kall/modifyKallMembers'), {
            timeout: 30_000,
          });
          await button(picker, /^(Done|Submit)$/i).click();
          const response = await changed;
          const sent = JSON.parse(response.request().postData() ?? '{}') as {
            addingUserIds?: string[];
          };
          expect
            .soft(sent.addingUserIds ?? [], 'the screen asks to add the third account')
            .toEqual(expect.arrayContaining([expect.stringMatching(/^qatest3@/i)]));
          expect.soft((await bodyOf(response)).status, 'the server adds them').toBe('SUCCESS');
        });

        await test.step('Cancel Kall › Proceed cancels the meeting (status 2)', async () => {
          const modal = await openMeeting(page, current);
          await button(modal, 'Cancel Kall').click();
          const confirm = page
            .getByRole('dialog')
            .filter({ hasText: /Proceed/ })
            .last();
          const update = await statusUpdate(page, () => button(confirm, 'Proceed').click());
          expect.soft(update.kallStatus, 'the screen sends Cancelled (2)').toBe(2);
          expect.soft(update.body.status, 'the server cancels it').toBe('SUCCESS');
          const reopened = await openMeeting(page, current);
          await expect
            .soft(reopened.getByText('Kool Kall Cancelled'), 'the meeting now reads Cancelled')
            .toBeVisible({ timeout: 15_000 });
        });
      } finally {
        await endMeeting(endpoints, ids);
      }
    });

    test('an invitee accepts one meeting and declines another with a reason', async ({
      browser,
      endpoints,
    }) => {
      // The invitee's browser session is signed in by setup only with this flag.
      requireFlags('KATCHUP_UI_LIFECYCLE');
      const accept = `QA kool accept ${Date.now()}`;
      const decline = `QA kool decline ${Date.now()}`;
      const ids = [
        await schedule(endpoints, accept, 24 * HOUR, [testData.victimKpostId]),
        await schedule(endpoints, decline, 25 * HOUR, [testData.victimKpostId]),
      ];
      const b = await openSession(browser, STORAGE_STATE_2);
      try {
        await test.step('Accept (status 10)', async () => {
          const modal = await openMeeting(b.page, accept);
          const update = await statusUpdate(b.page, () => button(modal, 'Accept').click());
          expect.soft(update.kallStatus, 'the screen sends Accepted (10)').toBe(10);
          expect.soft(update.body.status, 'the server records it').toBe('SUCCESS');
          const reopened = await openMeeting(b.page, accept);
          await expect
            .soft(
              button(reopened, 'Join'),
              'an accepted invite offers Join (until it starts, disabled)',
            )
            .toBeVisible({ timeout: 15_000 });
        });

        await test.step('Decline › reason › Done (status 4)', async () => {
          const modal = await openMeeting(b.page, decline);
          await button(modal, 'Decline').click();
          const reason = b.page
            .getByRole('dialog')
            .filter({ hasText: /Reason if Any/i })
            .last();
          await reason.locator('textarea').first().fill('QA bench: declining a test meeting');
          const update = await statusUpdate(b.page, () => button(reason, 'Done').click());
          expect.soft(update.kallStatus, 'the screen sends Declined (4)').toBe(4);
          expect.soft(update.body.status, 'the server records it').toBe('SUCCESS');
          const reopened = await openMeeting(b.page, decline);
          await expect
            .soft(reopened.getByText('Declined').first(), 'the meeting now reads Declined')
            .toBeVisible({ timeout: 15_000 });
        });
      } finally {
        await b.context.close();
        await endMeeting(endpoints, ids);
      }
    });

    test('once a meeting starts, the host can join and an invitee can mark Not Join with a reason', async ({
      page,
      browser,
      endpoints,
    }) => {
      // The invitee's browser session is signed in by setup only with this flag.
      requireFlags('KATCHUP_UI_LIFECYCLE');
      const title = `QA kool started ${Date.now()}`;
      // Starts 90 s from now: a past start is refused, and Join opens only once it has started.
      const startsAt = Date.now() + 90_000;
      const kallID = await schedule(endpoints, title, 90_000, [testData.victimKpostId]);
      const b = await openSession(browser, STORAGE_STATE_2);
      try {
        await test.step('the invitee accepts before it starts', async () => {
          const modal = await openMeeting(b.page, title);
          const update = await statusUpdate(b.page, () => button(modal, 'Accept').click());
          expect(update.body.status, 'the invite is accepted (needed for Not Join)').toBe(
            'SUCCESS',
          );
        });
        // Join opens only once the start time has passed.
        await expect
          .poll(() => Date.now(), { timeout: 150_000, intervals: [5_000] })
          .toBeGreaterThan(startsAt + 10_000);

        await test.step('Kool Kall tab: a started meeting offers Join to the invitee', async () => {
          const modal = await openMeeting(b.page, title, 'kool');
          await expect
            .soft(
              button(modal, 'Join'),
              'Join is enabled once the meeting has started (Kool Kall tab)',
            )
            .toBeEnabled({ timeout: 15_000 });
          await b.page.keyboard.press('Escape');
        });

        await test.step('Recents: Not Join › reason › Done (status 11)', async () => {
          const modal = await openMeeting(b.page, title, 'recents');
          await expect(button(modal, 'Not Join'), 'Not Join is enabled once started').toBeEnabled({
            timeout: 15_000,
          });
          await button(modal, 'Not Join').click();
          const reason = b.page
            .getByRole('dialog')
            .filter({ hasText: /Reason for Not Joining/i })
            .last();
          await reason.locator('textarea').first().fill('QA bench: not joining a test meeting');
          const update = await statusUpdate(b.page, () => button(reason, 'Done').click());
          expect.soft(update.kallStatus, 'the screen sends Not Joined (11)').toBe(11);
          expect.soft(update.body.status, 'the server records it').toBe('SUCCESS');
        });

        await test.step('the host joins: the KPost meeting room opens', async () => {
          const modal = await openMeeting(page, title, 'recents');
          await button(modal, 'Join').click();
          await expect
            .soft(
              page.locator('iframe[src*="jitsi.kpostindia.com"]').first(),
              'the Jitsi meeting room opens in the app',
            )
            .toBeAttached({ timeout: 30_000 });
        });
      } finally {
        await b.context.close();
        await endMeeting(endpoints, [kallID]);
      }
    });
  },
);
