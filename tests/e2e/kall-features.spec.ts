import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { gotoKoolKall, meetingTitleField, openCreateKall } from './support/kall';

/**
 * **Kall** feature flows (FR-C01..C09, BR-C01), from `components/Kall/` (see `docs/ui/ui-build-plan.md`).
 * Root `.kall-layout-shell`; tabs "Recents" / "Contacts" / "Kool Kall".
 *
 * Direct calling **rings a real device**, so it is **assert-only** (open the Kall-Info modal, confirm
 * the audio/video controls exist, never place the call). Scheduling a Kool Kall is a safe write, gated
 * behind `KALL_UI_LIFECYCLE=true` and self-cleaning.
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
      // KallContact.js (2026-10-20): the Contacts tab shows a chip "My Contacts • N"
      // (`.contact-background-style` / `.contact-chip-count`, N = the contact list's length). Opening it
      // lists each group as a `.contact-dropdown-main` row with its count, followed by its kinds
      // (`.contact-dropdown-sub`: Personal / Business / Institution / Government) with theirs. A kind
      // count is the number of that group's contacts of that kind, so the kinds must add up to the group.
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
      const total = Number(
        (await chip.locator('.contact-chip-count').innerText()).replace(/[^\d]/g, ''),
      );
      expect(total, 'and shows how many contacts there are').toBeGreaterThan(0);

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

    /**
     * The CreateKallModal is opened by the cursor-pointer `.create_font` "Create" control (the sibling
     * `.create_button` div is a silent no-op), and its schedule fields are **native HTML inputs**
     * (`type=date name=birthday`, two `type=time` From/To) — `fill()` with ISO values is reliable, no
     * custom picker. This drives and verifies the whole schedule form green: modal → Meeting Title →
     * future Date → From/To times → the participant picker OPENS (Invite Participants reveals the
     * contacts). Submit stays disabled until a participant is added.
     *
     * NEEDS-CODEGEN — the final Submit: the participant is chosen from a **nested-scroll custom contact
     * picker** (the rows are not a plain button/checkbox and sit in an off-viewport scroll container), so
     * selecting one and enabling Submit needs one interactive `codegen` pass. The API Kall lifecycle
     * (`scheduledKall` → `reScheduleKall`, BR-C01, green on live) proves the schedule create/reschedule
     * itself works — only the participant-picker UI-driving step is pending.
     */
    test('the schedule modal opens and accepts the meeting details (title + future date + time) @ui', async ({
      page,
    }) => {
      const title = `QA UI kall ${Date.now()}`;
      // Kool Kall tab + Create → the Create Kool Kall modal (support/kall.ts, re-tuned 2026-10-11).
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

      // The participant picker opens (Invite Participants reveals the contact list) — the last step before
      // Submit; selecting a contact from it is the codegen-pending piece documented above.
      // The "Invite" action beside the Participant field opens the picker (the field text itself is
      // a placeholder, not the trigger — screenshot 2026-10-11).
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
