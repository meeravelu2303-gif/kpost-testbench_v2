import type { Browser, BrowserContext, Dialog, Locator, Page } from '@playwright/test';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { LoginPage } from '@pages/LoginPage';
import { expect, test } from '@fixtures';
import { isKnownAppAlert } from '../../support/known-dialogs';

/**
 * Shared steps for the end-to-end USER JOURNEYS (`tests/e2e/journeys/*`). Every step here is lifted
 * from a spec that already ran green on live — the source is cited on each — so a journey composes
 * proven pieces rather than inventing selectors. Where a journey needs a step no spec has proven yet,
 * the journey says so in its own header ("UNPROVEN STEP"), never here.
 *
 * ## Who is who
 *
 * - **A** — `qatest1`, the default `page` (`.auth/user.json`).
 * - **B** — `qatest2`, a second browser context (`.auth/user2.json`, `auth2.setup.ts`).
 * - **C** — `qatest3`, used ONLY through the API, as the organizer of a meeting or a group.
 *
 * ## The one-session rule
 *
 * The server keeps ONE session per account: an API call authenticated as A or B logs that account's
 * browser out (`support/groups.ts`, `katchup-group-receipts-e2e.spec.ts`). So a journey never calls
 * the API as A or B while their browsers are open; API set-up and clean-up run as C. Where an API call
 * as A is unavoidable, the journey ends with `restoreSavedSession`, which signs A back in through the
 * real login screen and re-saves `.auth/user.json`, so every later test still has a live session.
 */

const principal = (key: string): Principal | undefined =>
  AUTH_PROFILES.kpost.principals.find((p) => p.key === key);

export const A = principal('personal');
export const B = principal('victim');
export const C = principal('personal-3');

/** True when the account is a real configured one, not a schema default. */
const real = (id: string | undefined): boolean =>
  Boolean(id) && !id!.includes('qa.bench') && !id!.includes('qa.victim') && !id!.includes('qa.p3');

/** Skip the journey unless the accounts it needs are configured. */
export function requireAccounts(...who: Array<'A' | 'B' | 'C'>): void {
  const ids = { A: testData.kpostId, B: testData.victimKpostId, C: testData.personal3KpostId };
  const missing = who.filter((w) => !real(ids[w]));
  test.skip(
    missing.length > 0,
    `needs the QA accounts ${missing.join(', ')} (QA_KPOST_ID / QA_VICTIM_KPOST_ID / QA_PERSONAL_3_KPOST_ID)`,
  );
}

/** Skip unless every named lifecycle flag is on (the `ui*` product commands set them all). */
export function requireFlags(...flags: string[]): void {
  const off = flags.filter((f) => process.env[f] !== 'true');
  test.skip(off.length > 0, `writes real data; set ${off.join(', ')}=true`);
}

/** A second signed-in browser for another account. */
export async function openSession(
  browser: Browser,
  storageState: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState });
  return { context, page: await context.newPage() };
}

/** Wait out the SPA's loading overlay (best-effort: it is absent on a fast load). */
export async function waitLoaded(page: Page): Promise<void> {
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
}

// ------------------------------------------------------------------------------------------- KMail

/**
 * Compose and send a plain mail in the UI (`kmail-two-session-e2e.spec.ts` `sendFromUi`, with the
 * `/writemail` reload guard from `kmail-actions-e2e.spec.ts`). Returns the request the app sent.
 */
export async function sendMailFromUi(
  page: Page,
  to: string,
  subject: string,
  body: string,
): Promise<Record<string, unknown>> {
  await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitLoaded(page);
  // Late in a run /writemail can restore the last opened conversation instead of a blank compose.
  const subjectBox = page.locator('.toInput').first();
  if (!(await subjectBox.isVisible({ timeout: 8_000 }).catch(() => false))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitLoaded(page);
  }
  await page.locator('.ql-editor[contenteditable="true"]').first().click();
  await page.keyboard.type(body);
  const toField = page.locator('.subjectTextboxKmailTO, input[name="to"]').first();
  await toField.click();
  await toField.fill(to);
  await page
    .locator('.suggestion-dropdown')
    .getByText(to, { exact: false })
    .first()
    .click({ timeout: 4_000 })
    .catch(() => undefined);
  await subjectBox.fill(subject);
  const sent = page.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
    timeout: 20_000,
  });
  await page
    .locator('.post_button_size')
    .filter({ has: page.locator('.icon-KP_3164') })
    .first()
    .click()
    .catch(() => page.locator('.post_button_size').first().click());
  const response = await sent;
  expect(response.status(), `the mail "${subject}" is sent`).toBe(200);
  return (response.request().postDataJSON() ?? {}) as Record<string, unknown>;
}

/** Find a mail by its subject in KMail and open it (`kmail-two-session-e2e.spec.ts`). */
export async function openMail(page: Page, subject: string): Promise<void> {
  await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitLoaded(page);
  await page.locator('.Serach_input').first().fill(subject);
  const row = page.getByText(subject, { exact: false }).first();
  await expect(row, `the mail "${subject}" is in KMail`).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(
    page.getByText(`Sub : ${subject}`, { exact: false }).first(),
    `the mail "${subject}" opens`,
  ).toBeVisible({ timeout: 20_000 });
}

/** Reply to the opened mail (ReplyIcon → Reply) and return the reply request the app sent. */
export async function replyToOpenMail(page: Page, text: string): Promise<Record<string, unknown>> {
  await page.getByTestId('ReplyIcon').first().click();
  await page.locator('[role="menu"]').getByText('Reply', { exact: true }).first().click();
  const editor = page.locator('.ql-editor[contenteditable="true"]').last();
  await expect(editor, 'the reply composer opens').toBeVisible({ timeout: 15_000 });
  await editor.click();
  await page.keyboard.type(text);
  const sent = page.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
    timeout: 20_000,
  });
  await page
    .locator('.post_button_size')
    .filter({ has: page.locator('.icon-KP_3164') })
    .last()
    .click()
    .catch(() => page.locator('.post_button_size').last().click());
  const response = await sent;
  expect(response.status(), 'the reply is sent').toBe(200);
  return (response.request().postDataJSON() ?? {}) as Record<string, unknown>;
}

/**
 * Delete the opened mail from this account's side, through the UI: ReplyIcon → More → Delete → the
 * native confirm (`kmail-features-e2e.spec.ts`, proven for the RECEIVER's copy). Best-effort for use
 * in `finally`: returns whether the delete request was accepted.
 */
export async function deleteOpenMail(page: Page): Promise<boolean> {
  const onDialog = (dialog: Dialog): void => {
    if (isKnownAppAlert(dialog) || dialog.type() !== 'confirm') void dialog.dismiss();
    else void dialog.accept();
  };
  page.on('dialog', onDialog);
  try {
    await page.getByTestId('ReplyIcon').first().click();
    const menu = page.locator('[role="menu"]');
    await menu.getByText('More', { exact: true }).first().click();
    const deleted = page.waitForResponse(
      (r) => /delete/i.test(r.url()) && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await menu.getByText('Delete', { exact: true }).first().click();
    return (await deleted).status() === 200;
  } finally {
    page.off('dialog', onDialog);
  }
}

/**
 * Delete the opened mail from the SENDER's side: the sender's mail carries the bell menu
 * (KmailMessageBox.js `bellIconContent`, which lists Delete), the recipient's the reply arrow
 * (`deleteOpenMail`). Delete asks with the browser's own confirm box (`cross-layer-flows.spec.ts`).
 */
export async function deleteOpenSentMail(page: Page): Promise<boolean> {
  page.once('dialog', (d) => void d.accept().catch(() => undefined));
  await page.getByTestId('NotificationsNoneIcon').first().click();
  const menu = page.locator('[role="menu"]');
  const more = menu.getByText('More', { exact: true }).first();
  if (await more.isVisible({ timeout: 2_000 }).catch(() => false)) await more.click();
  const deleted = page.waitForResponse(
    (r) => /delete/i.test(r.url()) && r.request().method() === 'POST',
    { timeout: 20_000 },
  );
  await menu.getByText('Delete', { exact: true }).first().click();
  return (await deleted).status() === 200;
}

// ----------------------------------------------------------------------------------------- Session

/** Log out through the header pill and its confirm modal (`login-session.spec.ts`, green on live). */
export async function logoutFromUi(page: Page): Promise<void> {
  await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitLoaded(page);
  await page.locator('.header-user-pill').first().click();
  await page
    .getByText(/^Log ?out$/i)
    .first()
    .click()
    .catch(() => undefined);
  await expect(
    page.getByText(/Are you sure you want to logout/i).first(),
    'the logout confirm appears',
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole('button', { name: /^Logout$/i })
    .first()
    .click();
  await expect(page, 'logout returns to the login screen').toHaveURL(/\/login/, {
    timeout: 20_000,
  });
}

/** Sign in through the real login screen (`LoginPage`), landing on Home. */
export async function signInFromUi(page: Page, kpostId: string, password: string): Promise<void> {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(kpostId, password);
  await expect(page, `${kpostId} lands on Home after signing in`).toHaveURL(/\/home/, {
    timeout: 30_000,
  });
}

/**
 * Sign A back in through the UI and re-save the shared session file, after a step that ended A's
 * session (a logout, or an API call as A). Without this every later test in the run starts signed out.
 */
export async function restoreSavedSession(
  page: Page,
  kpostId: string,
  password: string,
  storageStatePath: string,
): Promise<void> {
  // The browser still holds the dead token; drop it so the app shows its login form, not a redirect.
  await page.context().clearCookies();
  // The app may be redirecting to /login itself at this moment, which aborts our own goto with
  // "interrupted by another navigation to …/login" (2026-10-22: that left .auth/user.json dead).
  // Landing on /login either way is the goal, so only that specific race is tolerated.
  await page
    .goto('/login', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    .catch(async (error: Error) => {
      if (!/interrupted by another navigation to .*\/login/.test(error.message)) throw error;
      await page.waitForURL(/\/login/, { timeout: 20_000 });
    });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await signInFromUi(page, kpostId, password);
  await page.context().storageState({ path: storageStatePath });
}

/** A step that is proven by journeys only in the UI it renders: the visible-text check. */
export function textOn(page: Page, text: string): Locator {
  return page.getByText(text, { exact: false }).first();
}
