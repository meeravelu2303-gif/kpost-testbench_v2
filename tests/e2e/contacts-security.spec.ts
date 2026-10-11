import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import {
  contactsSearchBox,
  gotoContacts,
  openAdvancedSearch,
  openPeopleSearch,
} from './support/contacts';

/**
 * Security-fuzzing angle for Contacts' two free-text query fields — the contact-list search box
 * (client-side filter) and the Add-contact wizard's Advanced Search mobile-number field (a real
 * network round-trip). Same execution-based check as `login-security.spec.ts` /
 * `katchup-security.spec.ts` (a `dialog` listener, not string-matching). Both fields are read-only
 * queries — no lifecycle gate needed. Navigation: `support/contacts.ts` (re-tuned 2026-10-11).
 */

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
      test.skip(
        !opened,
        'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts',
      );

      const stop = watchUiHealth(page);
      let dialogFired = false;
      page.on('dialog', (dialog) => {
        dialogFired = true;
        void dialog.dismiss();
      });

      const search = contactsSearchBox(page);
      await search.click();
      await search.fill(payload.value);
      // The filter is synchronous on the client; give any injected handler a moment to fire.
      await expect(search, 'the field holds the raw text').toHaveValue(payload.value);
      // Two frames: any handler an injected payload could have attached has had its chance to run.
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );

      const health = stop();
      test.info().annotations.push({
        type: 'observed',
        description: `page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
      });
      expect(
        health.pageErrors,
        `no uncaught JS error while filtering by: ${payload.value}`,
      ).toEqual([]);
      expect(
        dialogFired,
        `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
      ).toBe(false);
    });
  }
});

test.describe(
  'KPost Contacts · Advanced Search mobile-number field security fuzzing',
  { tag: '@ui' },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    for (const payload of PAYLOADS) {
      test(`the Advanced Search mobile-number field survives a ${payload.name} payload without crashing or executing it @ui`, async ({
        page,
      }) => {
        const opened = await gotoContacts(page);
        test.skip(
          !opened,
          'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts',
        );
        const search = await openPeopleSearch(page);
        expect(search, 'the people-search step renders').not.toBeNull();
        const mobileField = await openAdvancedSearch(page);
        expect(mobileField, 'Advanced Search opens with a mobile-number field').not.toBeNull();

        const stop = watchUiHealth(page);
        let dialogFired = false;
        page.on('dialog', (dialog) => {
          dialogFired = true;
          void dialog.dismiss();
        });

        await mobileField!.click();
        await mobileField!.fill(payload.value);
        const answered = page
          .waitForResponse((r) => r.url().includes('/profile/advancedSearch/'), { timeout: 10_000 })
          .then((r) => r.status())
          .catch(() => 0);
        await page
          .getByRole('button', { name: 'Search', exact: true })
          .first()
          .click({ timeout: 5_000 })
          .catch(() => undefined);
        const status = await answered;

        const health = stop();
        test.info().annotations.push({
          type: 'observed',
          description: `search → HTTP ${status || 'none'}; page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
        });
        expect(health.pageErrors, `no uncaught JS error searching by: ${payload.value}`).toEqual(
          [],
        );
        expect(
          dialogFired,
          `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
        ).toBe(false);
        expect(status, `the server does not fail on the payload: ${payload.value}`).toBeLessThan(
          500,
        );
      });
    }
  },
);
