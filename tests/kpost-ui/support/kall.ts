import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { parkPointerAwayFromSideMenu } from './katchup';

/**
 * Shared Kall steps: "Kool Kall" is a tab (not a button), and its `.create_font` control opens the
 * "Create Kool Kall" modal.
 */
export async function gotoKoolKall(page: Page): Promise<void> {
  await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  await parkPointerAwayFromSideMenu(page);
  await page
    .getByRole('tab', { name: /Kool Kall/i })
    .first()
    .click({ timeout: 15_000 });
}

/** From the Kool Kall tab: Create → the Create Kool Kall modal; returns the modal (or null). */
export async function openCreateKall(page: Page): Promise<Locator | null> {
  const create = page.locator('.create_font').first();
  await expect(create, 'the Create control is present on the Kool Kall tab').toBeVisible({
    timeout: 20_000,
  });
  await create.click();
  const modal = page
    .getByRole('dialog')
    .filter({ hasText: /Create Kool Kall/i })
    .first();
  const opened = await modal.isVisible({ timeout: 15_000 }).catch(() => false);
  return opened ? modal : null;
}

/** The modal's meeting-title field. */
export function meetingTitleField(modal: Locator): Locator {
  return modal.locator('input[placeholder="Enter Meeting Title"]').first();
}

/** The kallID in a scheduledKall / reScheduleKall reply. */
export function kallIdOf(body: unknown): number | undefined {
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

export async function scheduleMeeting(
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

export async function endMeeting(endpoints: EndpointExecutor, kallIDs: Array<number | undefined>) {
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
export async function openMeeting(page: Page, title: string, from: 'kool' | 'recents' = 'kool') {
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

/** A button in `scope` by its exact name (or a pattern). */
export function button(scope: Locator, name: string | RegExp): Locator {
  return scope
    .getByRole('button', { name: typeof name === 'string' ? new RegExp(`^${name}$`, 'i') : name })
    .first();
}
