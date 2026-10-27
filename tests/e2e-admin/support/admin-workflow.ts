import { env } from '@config/env';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import { isLiveHost } from '@config/live-hosts';

/**
 * Helpers for create/edit/delete flows on the Admin/HR-Setup screens. The front-end source points at
 * the live Admin API, so a write test first proves the screen calls the test Admin box (else skips),
 * and any non-GET request to a live host is aborted and reported.
 */

/** Admin API paths the screens call (Services/AdminSetup.js, HumanResources.js). */
const ADMIN_API_PATH =
  /\/(adminTierAttribute|adminTierVariable|hrSetUpTierAttribute|hrSetUpTierVariable|location|employeeDetails|rolePosting|country)\//;

export interface AdminHostGuard {
  /** Hosts the screen's Admin API calls went to. */
  adminHosts: Set<string>;
  /** Writes to a live host that were aborted (method + URL). */
  blockedLiveWrites: string[];
}

/** Writes on the Admin screens need the UI session AND the Admin write lifecycle (both set by the runner). */
export function requireAdminUiWrites(): void {
  test.skip(
    process.env.ADMIN_UI_LIFECYCLE !== 'true' ||
      process.env.ADMIN_LIFECYCLE !== 'true' ||
      !env.ADMIN_UI_BASE_URL ||
      !env.ADMIN_API_BASE_URL,
    'creates and deletes Admin records on screen; needs ADMIN_UI_LIFECYCLE=true, ADMIN_LIFECYCLE=true and both Admin hosts',
  );
}

/** Install before the first navigation: records Admin API hosts and aborts any write to a live host. */
export async function guardAdminHosts(page: Page): Promise<AdminHostGuard> {
  const guard: AdminHostGuard = { adminHosts: new Set(), blockedLiveWrites: [] };
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (ADMIN_API_PATH.test(url.pathname)) guard.adminHosts.add(url.host);
    if (req.method() !== 'GET' && isLiveHost(url.hostname)) {
      guard.blockedLiveWrites.push(`${req.method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  return guard;
}

/**
 * After a screen has loaded its data: skip unless every Admin API call went to the TEST Admin box.
 * Writing through a build wired to the live Admin API would put QA records into live data.
 */
export function requireTestAdminApi(guard: AdminHostGuard): void {
  const testHost = new URL(env.ADMIN_API_BASE_URL!).host;
  const hosts = [...guard.adminHosts];
  test.info().annotations.push({
    type: 'observed',
    description: `Admin API hosts: ${hosts.join(', ') || 'none seen'}`,
  });
  test.skip(
    hosts.length === 0 || hosts.some((h) => h !== testHost),
    `the Admin UI build calls ${hosts.join(', ') || 'no Admin API yet'}, not the test Admin API (${testHost}) — no record is written through it`,
  );
}

/**
 * One step of a flow that must not hide the steps after it: a failure is recorded (the test still
 * fails) and the flow carries on. `blocker: true` stops the test, for a step the rest cannot run
 * without. Returns whether the stage passed.
 */
export async function stage(
  name: string,
  body: () => Promise<void>,
  options: { blocker?: boolean } = {},
): Promise<boolean> {
  try {
    await test.step(name, body);

    return true;
  } catch (error) {
    // A blocker, or a `test.skip()` inside the stage (it throws to stop the test), ends the test.
    if (options.blocker || test.info().expectedStatus === 'skipped') throw error;
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    expect.soft(message, `stage "${name}" failed (the flow continued): ${message}`).toBe('');
    return false;
  }
}

/** The guard must have caught nothing: a page write to a live host is itself a finding. */
export function expectNoLiveWrites(guard: AdminHostGuard): void {
  expect(
    guard.blockedLiveWrites,
    'the Admin screen tried to write to a live host (blocked)',
  ).toEqual([]);
}

/**
 * POST to the TEST Admin API with the PAGE's own token, for read-backs and clean-ups. Never the
 * `endpoints` fixture as the same account: one session per account (an API login would sign the page out).
 */
export async function adminApiAsPage(
  page: Page,
  path: string,
  body: unknown,
): Promise<{ status: number; text: string }> {
  const url = `${env.ADMIN_API_BASE_URL!.replace(/\/$/, '')}${path}`;
  return page.evaluate(
    async ([u, b]) => {
      const r = await fetch(u, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}`,
        },
        body: JSON.stringify(b),
      });
      return { status: r.status, text: await r.text() };
    },
    [url, body] as const,
  );
}

/** The next response to an Admin API path the screen sends, parsed (`{value, status, statusCode}`). */
export async function nextAdminCall(
  page: Page,
  path: string,
  act: () => Promise<void>,
): Promise<{ status: number; body: { value?: unknown; status?: string; error?: unknown } }> {
  const answer = page.waitForResponse(
    (r) => r.url().includes(path) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await act();
  const r = await answer;
  const body = (await r.json().catch(() => ({}))) as {
    value?: unknown;
    status?: string;
    error?: unknown;
  };
  return { status: r.status(), body };
}

/** A unique, recognisable record name. */
export const qaName = (label: string): string => `QA ${label} ${Date.now() % 1_000_000}`;

/** The id a save answered with: `value[0].id` (array saves) or `value.id`. */
export function savedId(value: unknown): string | undefined {
  const rec: unknown = Array.isArray(value) ? value[0] : value;
  return rec && typeof rec === 'object' && typeof (rec as { id?: unknown }).id === 'string'
    ? (rec as { id: string }).id
    : undefined;
}

/** Open a screen and wait for its title (`.title-font`). */
export async function openAdminScreen(page: Page, route: string, title: RegExp): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(
    page.locator('.title-font').filter({ hasText: title }).first(),
    `${route} opened`,
  ).toBeVisible({
    timeout: 20_000,
  });
}

/** A pill tab (Tier / Variable / …). */
export async function openTab(page: Page, name: string): Promise<void> {
  await page
    .locator('.nav-link, a')
    .filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) })
    .first()
    .click();
}

/**
 * The icon bar: Add first, the eye (list) always last. Visible ones only: a tabbed screen keeps the
 * other tab's icons in the DOM, hidden.
 */
const icons = (page: Page): Locator => page.locator('.boderIcon:visible, .borderIconCol:visible');
export const openAdd = (page: Page): Promise<void> => icons(page).first().click();
/** Shows the list. The eye toggles it, so click only while no table is showing. */
export async function openList(page: Page): Promise<void> {
  // KSmartTable's own wrapper (src/Common/KSmartTable.js), not any table: forms have their own.
  const list = page.locator('.smart-table-wrapper:visible').first();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await list.isVisible().catch(() => false)) return;
    await icons(page).last().click();
    if (
      await list
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false)
    )
      return;
  }
  await expect(list, 'the list opens').toBeVisible({ timeout: 10_000 });
}

/** The open KDrawer. */
export const drawer = (page: Page): Locator => page.locator('.custom-drawer.open');

/** The KSmartTable row holding `text` (searched first, so pagination never hides it). */
export async function tableRow(page: Page, text: string): Promise<Locator> {
  const search = page.getByPlaceholder('Search', { exact: true }).last();
  if (await search.isVisible().catch(() => false)) await search.fill(text);
  const row = page.locator('tr').filter({ hasText: text }).first();
  await expect(row, `the list shows "${text}"`).toBeVisible({ timeout: 20_000 });
  return row;
}

/** The row's ⋮ menu → Edit / Delete. */
export async function rowAction(
  page: Page,
  row: Locator,
  action: 'Edit' | 'Delete',
): Promise<void> {
  await row.getByRole('button').last().click();
  await page
    .locator('.dropdown-item, [role="menuitem"]')
    .filter({ hasText: new RegExp(`^\\s*${action}\\s*$`) })
    .first()
    .click();
}

/** KSmartTable's "Delete Confirmation" modal → Delete. */
export async function confirmDelete(page: Page): Promise<void> {
  const modal = page.locator('.modal').filter({ hasText: 'Delete Confirmation' }).first();
  await expect(modal, 'the delete confirmation opens').toBeVisible({ timeout: 10_000 });
  await modal.locator('button.deletebutton').click();
}

/** A react-select scoped by its label (KDropdown), picking an option by name or the first one. */
export async function pickDropdown(
  page: Page,
  label: string,
  option?: string | RegExp,
): Promise<string> {
  const box = page
    .locator('div.label-font')
    .filter({ has: page.locator('label', { hasText: label }) })
    .first();
  // react-select: the placeholder covers the input, so focus it and open the menu from the keyboard;
  // a named option is typed to filter the list.
  const input = box.locator('input').first();
  await input.focus();
  if (typeof option === 'string') await input.fill(option);
  else await input.press('ArrowDown');
  const opt = option
    ? page.getByRole('option', { name: option }).first()
    : page.getByRole('option').first();
  await expect(opt, `"${label}" offers ${option ? String(option) : 'an option'}`).toBeVisible({
    timeout: 15_000,
  });
  const chosen = (await opt.innerText()).trim();
  await opt.click();
  return chosen;
}

/**
 * A react-select found by its placeholder text (the Employee Data stepper's selects have no KDropdown
 * label). `index` picks among selects sharing a placeholder (residential first, mailing second).
 */
export async function pickByPlaceholder(
  page: Page,
  placeholder: string,
  option?: string,
  index = 0,
): Promise<string> {
  // react-select renders the placeholder div just before its input inside the value container.
  const input = page
    .locator('[class*="placeholder"]', { hasText: placeholder })
    .nth(index)
    .locator('xpath=following::input[1]');
  await input.focus();
  if (option) await input.fill(option);
  else await input.press('ArrowDown');
  const opt = option
    ? page.getByRole('option', { name: new RegExp(`^${option}`, 'i') }).first()
    : page.getByRole('option').first();
  await expect(opt, `"${placeholder}" offers ${option ?? 'an option'}`).toBeVisible({
    timeout: 15_000,
  });
  const chosen = (await opt.innerText()).trim();
  await opt.click();
  return chosen;
}
