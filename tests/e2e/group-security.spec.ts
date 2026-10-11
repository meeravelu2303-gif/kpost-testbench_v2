import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { gotoContacts, openCreateGroup } from './support/contacts';

/**
 * Security-fuzzing angle for Group's **Group Name** field. Deliberately never reaches Create: unlike
 * the other write flows this session's fuzz specs reuse (Katchup recall, Settings/KMail's own accepted
 * no-cleanup precedent), `group.spec.ts`'s own create flow does NOT implement the delete step its
 * docstring claims ("self-cleaning") — completing Create here would leave a real, permanent,
 * un-deletable-by-this-suite group with a fuzzed name, visible to the 2nd QA account as an invited
 * member. So this only fills the Group Name field and reads its value back, exactly like
 * `kall-security.spec.ts`'s Meeting Title test — no lifecycle gate needed as a result.
 *
 * No separate `group-accessibility.spec.ts`: the Create-Group modal this field lives in is the SAME
 * dialog (`.icon-KP_112-Group-Add`) already scanned in `contacts-accessibility.spec.ts`'s "Create-Group
 * dialog open" test, so a second scan of it would be a pure duplicate.
 */
test.describe('KPost Group · Group Name field security fuzzing', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts',
  );

  const PAYLOADS: Array<{ name: string; value: string }> = [
    { name: 'script tag', value: '<script>alert(1)</script>' },
    { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
    { name: 'SQL-style OR-true', value: "' OR '1'='1" },
  ];

  for (const payload of PAYLOADS) {
    test(`the Group Name field survives a ${payload.name} payload without crashing or executing it @ui`, async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      let dialogFired = false;
      page.on('dialog', (dialog) => {
        dialogFired = true;
        void dialog.dismiss();
      });

      // The create-group icon lives in the Contacts tab (support/contacts.ts, re-tuned 2026-10-11).
      const tabOpened = await gotoContacts(page);
      test.skip(
        !tabOpened,
        'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts',
      );
      const modal = await openCreateGroup(page);
      expect(modal, 'the Create New Group modal opens').not.toBeNull();
      const nameField = modal!.getByRole('textbox', { name: /Group Name/i }).first();
      await expect(nameField, 'the Group Name field renders').toBeVisible();

      await nameField.fill(payload.value);
      await expect(nameField, 'the field holds the raw text, unmodified').toHaveValue(
        payload.value,
      );
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

      expect(health.pageErrors, `no uncaught JS error typing: ${payload.value}`).toEqual([]);
      expect(
        dialogFired,
        `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
      ).toBe(false);
      await expect(nameField, 'the field holds the raw text, unmodified').toHaveValue(
        payload.value,
      );
    });
  }
});
