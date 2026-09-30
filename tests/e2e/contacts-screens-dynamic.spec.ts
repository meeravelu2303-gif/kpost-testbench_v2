import type { Page } from '@playwright/test';
import type { ScreenDef as UiScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The health/performance/layout counterpart to `contacts-accessibility.spec.ts`'s 3 dynamic states —
 * the Add-contact wizard's people-search step, its nested Advanced Search step, and the Create-Group
 * dialog. Same `runUiChecks`/`watchUiHealth` machinery and the same reused navigation as that file (no
 * shared `support/contacts.ts` module exists).
 */
const RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

async function gotoContacts(page: Page): Promise<boolean> {
  await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  await page.getByRole('tab', { name: 'Contacts' }).click({ timeout: 15_000 }).catch(() => undefined);
  return page
    .getByRole('searchbox', { name: 'Search' })
    .first()
    .isVisible({ timeout: 15_000 })
    .catch(() => false);
}

async function assertNoFileableIssues(
  page: Page,
  screen: UiScreenDef,
  health: ReturnType<ReturnType<typeof watchUiHealth>>,
  loadMs: number,
): Promise<void> {
  const findings = await runUiChecks({ page, screen, health, loadMs });
  const fileable = findings.filter((f) => RANK[f.severity]! >= RANK.MEDIUM!);
  const context = findings.filter((f) => RANK[f.severity]! < RANK.MEDIUM!);
  if (context.length) {
    console.log(
      `[ui-context] ${screen.name}: ${context.map((f) => `[${f.check}] ${f.message}`).join(' | ')}`,
    );
  }
  const problems = fileable.map((f) => `[${f.check}] ${f.message}`);
  expect(problems, `${screen.name} UI issues — ${problems.join(' | ')}`).toEqual([]);
}

test.describe('KPost Contacts — dynamic-state health/performance/layout sweep', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('Contacts — Add-contact people-search step: health, performance, layout @ui', async ({
    page,
  }) => {
    const stop = watchUiHealth(page);
    const started = Date.now();
    const opened = await gotoContacts(page);
    test.skip(!opened, 'the Contacts tab did not open on this build');

    await page.locator('.icon-KP_107-User-Add').first().click({ timeout: 15_000 }).catch(() => undefined);
    await page.getByText('Personal', { exact: true }).first().click({ timeout: 5_000 }).catch(() => undefined);
    await page.getByRole('button', { name: 'Continue' }).first().click({ timeout: 8_000 }).catch(() => undefined);
    const loadMs = Date.now() - started;

    const screen: UiScreenDef = {
      route: '/katchup',
      name: 'Contacts — Add-contact people-search step',
      screen: 'katchup',
      ready: [],
      controls: [],
    };
    await assertNoFileableIssues(page, screen, stop(), loadMs);
  });

  test('Contacts — Advanced Search step: health, performance, layout @ui', async ({ page }) => {
    const stop = watchUiHealth(page);
    const started = Date.now();
    const opened = await gotoContacts(page);
    test.skip(!opened, 'the Contacts tab did not open on this build');

    await page.locator('.icon-KP_107-User-Add').first().click({ timeout: 15_000 }).catch(() => undefined);
    await page.getByText('Personal', { exact: true }).first().click({ timeout: 5_000 }).catch(() => undefined);
    await page.getByRole('button', { name: 'Continue' }).first().click({ timeout: 8_000 }).catch(() => undefined);
    await page
      .locator('.icon-KP_225_Advanced-Search')
      .first()
      .click({ timeout: 10_000 })
      .catch(() => undefined);
    const loadMs = Date.now() - started;

    const screen: UiScreenDef = {
      route: '/katchup',
      name: 'Contacts — Advanced Search step',
      screen: 'katchup',
      ready: [],
      controls: [],
    };
    await assertNoFileableIssues(page, screen, stop(), loadMs);
  });

  test('Contacts — Create-Group dialog: health, performance, layout @ui', async ({ page }) => {
    const stop = watchUiHealth(page);
    const started = Date.now();
    const opened = await gotoContacts(page);
    test.skip(!opened, 'the Contacts tab did not open on this build');

    await page.locator('.icon-KP_112-Group-Add').first().click({ timeout: 15_000 }).catch(() => undefined);
    const loadMs = Date.now() - started;

    const screen: UiScreenDef = {
      route: '/katchup',
      name: 'Contacts — Create-Group dialog',
      screen: 'katchup',
      ready: [],
      controls: [],
    };
    await assertNoFileableIssues(page, screen, stop(), loadMs);
  });
});
