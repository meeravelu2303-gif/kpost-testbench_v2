import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';

/**
 * Security-fuzzing angle for Contacts' two free-text query fields — the contact-list search box
 * (client-side filter) and the Add-contact wizard's Advanced Search mobile-number field (a real
 * network round-trip: `waitForResponse('**\/contacts/**')` in `contacts-functional.spec.ts`). Same
 * execution-based check as `login-security.spec.ts`/`home-security.spec.ts`/`katchup-security.spec.ts`
 * (a `dialog` listener, not string-matching). Both fields are read-only queries — no lifecycle gate
 * needed, matching `contacts-functional.spec.ts`'s own no-gate treatment of these same two fields.
 *
 * Navigation mirrors `contacts-functional.spec.ts`'s own `gotoContacts` helper and Advanced-Search
 * path exactly (no shared `support/contacts.ts` module exists yet to import from).
 */

async function gotoContacts(page: Page): Promise<boolean> {
  await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  await page
    .getByRole('tab', { name: 'Contacts' })
    .click({ timeout: 15_000 })
    .catch(() => undefined);
  return page
    .getByRole('searchbox', { name: 'Search' })
    .first()
    .isVisible({ timeout: 15_000 })
    .catch(() => false);
}

const PAYLOADS: Array<{ name: string; value: string }> = [
  { name: 'script tag', value: '<script>alert(1)</script>' },
  { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
  { name: 'SQL-style OR-true', value: "' OR '1'='1" },
];

test.describe('KPost Contacts · search box security fuzzing', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  for (const payload of PAYLOADS) {
    test(`the contact list search box survives a ${payload.name} payload without crashing or executing it @ui`, async ({
      page,
    }) => {
      const opened = await gotoContacts(page);
      test.skip(!opened, 'the Contacts tab did not open on this build — needs a codegen re-tune');

      const stop = watchUiHealth(page);
      let dialogFired = false;
      page.on('dialog', (dialog) => {
        dialogFired = true;
        void dialog.dismiss();
      });

      const search = page.getByRole('searchbox', { name: 'Search' }).last();
      await search.click();
      await search.fill(payload.value);
      await page.waitForTimeout(1_500);

      const health = stop();

      test.info().annotations.push({
        type: 'observed',
        description: `page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
      });

      expect(health.pageErrors, `no uncaught JS error while filtering by: ${payload.value}`).toEqual([]);
      expect(
        dialogFired,
        `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
      ).toBe(false);
    });
  }
});

test.describe('KPost Contacts · Advanced Search mobile-number field security fuzzing', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  for (const payload of PAYLOADS) {
    test(`the Advanced Search mobile-number field survives a ${payload.name} payload without crashing or executing it @ui`, async ({
      page,
    }) => {
      const opened = await gotoContacts(page);
      test.skip(!opened, 'the Contacts tab did not open on this build — needs a codegen re-tune');

      await page
        .locator('.icon-KP_107-User-Add')
        .first()
        .click({ timeout: 15_000 })
        .catch(() => undefined);
      await page
        .getByText('Personal', { exact: true })
        .first()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      await page
        .getByRole('button', { name: 'Continue' })
        .first()
        .click({ timeout: 8_000 })
        .catch(() => undefined);
      await page
        .locator('.icon-KP_225_Advanced-Search')
        .first()
        .click({ timeout: 10_000 })
        .catch(() => undefined);

      const mobileField = page.getByRole('textbox', { name: 'Enter Mobile Number' }).first();
      const reachable = await mobileField.isVisible({ timeout: 10_000 }).catch(() => false);
      test.skip(!reachable, 'advanced search did not open — needs a codegen re-tune');

      const stop = watchUiHealth(page);
      let dialogFired = false;
      page.on('dialog', (dialog) => {
        dialogFired = true;
        void dialog.dismiss();
      });

      await mobileField.click();
      await mobileField.fill(payload.value);
      await page
        .getByRole('button', { name: 'Search', exact: true })
        .first()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1_500);

      const health = stop();

      test.info().annotations.push({
        type: 'observed',
        description: `page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
      });

      expect(health.pageErrors, `no uncaught JS error searching by: ${payload.value}`).toEqual([]);
      expect(
        dialogFired,
        `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
      ).toBe(false);
    });
  }
});
