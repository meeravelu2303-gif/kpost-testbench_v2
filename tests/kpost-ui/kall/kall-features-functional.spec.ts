import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { gotoKoolKall, meetingTitleField, openCreateKall } from '../support/kall';

/**
 * Kall screen: tabs, the Contacts count breakdown, and the Kool Kall schedule form. Calls are never
 * placed (they ring a real device); scheduling is gated on KALL_UI_LIFECYCLE.
 */
test.describe('KPost Kall — read-only', { tag: ['@ui', '@kall', '@regression', '@sanity'] }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test(
    'the Kall screen shows its tabs (Recents / Contacts / Kool Kall) @ui',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KL-007' }] },
    async ({ page }) => {
      await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

      await expect(
        page.locator('.kall-layout-shell').first(),
        'the Kall screen renders',
      ).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        page.getByText(/Kool Kall/i).first(),
        'the Kool Kall tab is present',
      ).toBeVisible({
        timeout: 20_000,
      });
    },
  );

  test(
    'the Contacts screen shows the contact count, and each breakdown adds up to its total @ui',
    { annotation: [{ type: 'requirement', description: 'FR-KL-007' }] },
    async ({ page }) => {
      // The chip "My Contacts • N" opens a list of groups (`.contact-dropdown-main`), each followed by
      // its kinds (`.contact-dropdown-sub`); the kind counts must add up to the group's count.
      await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      await page
        .locator('.kall-layout-shell')
        .getByText(/^Contacts$/)
        .first()
        .click();
      const chip = page.locator('.contact-background-style').first();
      await expect(chip, 'the Contacts screen names the list').toContainText(/My Contacts/i, {
        timeout: 20_000,
      });
      // The count fills in after the list loads, so poll for it rather than reading it once.
      const countNow = async (): Promise<number> =>
        Number((await chip.locator('.contact-chip-count').innerText()).replace(/[^\d]/g, ''));
      await expect
        .poll(countNow, { message: 'and shows how many contacts there are', timeout: 20_000 })
        .toBeGreaterThan(0);
      const total = await countNow();

      await chip.click();
      const rows = page.locator('.contact-dropdown-row');
      await expect(rows.first(), 'the contact groups open').toBeVisible({ timeout: 10_000 });
      const groups: Array<{ name: string; count: number; kinds: Array<[string, number]> }> = [];
      for (const row of await rows.all()) {
        const name = (await row.locator('.contact-dropdown-label').innerText()).trim();
        const count = Number(
          (await row.locator('.contact-dropdown-count').innerText()).replace(/[^\d]/g, ''),
        );
        const isMain = /contact-dropdown-main/.test((await row.getAttribute('class')) ?? '');
        if (isMain) groups.push({ name, count, kinds: [] });
        else if (!/Mobile Contacts/i.test(name)) groups.at(-1)?.kinds.push([name, count]);
      }
      test.info().annotations.push({
        type: 'observed',
        description: `chip ${total}; ${groups.map((g) => `${g.name} ${g.count} = ${g.kinds.map(([k, n]) => `${k} ${n}`).join(' + ')}`).join(' | ')}`,
      });
      const mine = groups.find((g) => /^My Contacts$/i.test(g.name));
      expect(mine?.count, '"My Contacts" in the list matches the count on the chip').toBe(total);
      for (const g of groups.filter((x) => x.kinds.length))
        expect
          .soft(
            g.kinds.reduce((sum, [, n]) => sum + n, 0),
            `${g.name}: Personal + Business + Institution + Government add up to its ${g.count}`,
          )
          .toBe(g.count);
    },
  );
});

test.describe(
  'KPost Kall · schedule a Kool Kall (write)',
  { tag: ['@ui', '@kall', '@regression'] },
  () => {
    test.skip(
      process.env.KALL_UI_LIFECYCLE !== 'true',
      'creates a real scheduled call; set KALL_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account',
    );

    // Fills the schedule form (native date/time inputs) and opens the participant picker. Choosing a
    // participant and submitting is not automated yet: the picker is a nested-scroll custom list.
    test('the schedule modal opens and accepts the meeting details (title + future date + time) @ui', async ({
      page,
    }) => {
      const title = `QA UI kall ${Date.now()}`;
      // Kool Kall tab + Create → the Create Kool Kall modal.
      await gotoKoolKall(page);
      const opened = await openCreateKall(page);
      expect(opened, 'the schedule modal opens').not.toBeNull();
      const modal = opened!;
      const titleField = meetingTitleField(modal);
      await expect(titleField, 'the schedule modal opens with a Meeting Title field').toBeVisible({
        timeout: 15_000,
      });

      // Native date/time inputs — a future date keeps the schedule valid.
      await titleField.fill(title);
      await modal.locator('input[name="birthday"]').first().fill('2026-12-31');
      const times = modal.locator('input[type="time"]');
      await times.nth(0).fill('10:00');
      await times.nth(1).fill('10:30');

      // The fields hold their values (the schedule form is driven correctly).
      await expect(titleField, 'the Meeting Title accepts text').toHaveValue(title);
      await expect(modal.locator('input[name="birthday"]').first()).toHaveValue('2026-12-31');
      await expect(times.nth(0)).toHaveValue('10:00');

      // "Invite" beside the Participant field opens the picker; the field text is only a placeholder.
      await modal
        .getByText(/^Invite$/)
        .first()
        .click();
      // The picker lists this account's contacts as selectable rows; the names depend on the account
      // in use, so assert the list (a row avatar or checkbox), not a name.
      await expect(
        page.locator('[role="dialog"] .sb-avatar, [role="dialog"] input[type="checkbox"]').first(),
        'the participant picker lists selectable contacts',
      ).toBeVisible({ timeout: 15_000 });
    });
  },
);
