import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * **Kall** feature flows (FR-C01..C09, BR-C01), from `components/Kall/` (see `docs/ui-build-plan.md`).
 * Root `.kall-layout-shell`; tabs "Recents" / "Contacts" / "Kool Kall".
 *
 * Direct calling **rings a real device**, so it is **assert-only** (open the Kall-Info modal, confirm
 * the audio/video controls exist, never place the call). Scheduling a Kool Kall is a safe write, gated
 * behind `KALL_UI_LIFECYCLE=true` and self-cleaning.
 */
test.describe('KPost Kall — read-only', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the Kall screen shows its tabs (Recents / Contacts / Kool Kall) @ui', async ({ page }) => {
    await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    await expect(page.locator('.kall-layout-shell').first(), 'the Kall screen renders').toBeVisible(
      {
        timeout: 20_000,
      },
    );
    await expect(page.getByText(/Kool Kall/i).first(), 'the Kool Kall tab is present').toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe('KPost Kall · schedule a Kool Kall (write)', { tag: '@ui' }, () => {
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
    await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    // Switch to the Kool Kall TAB (the nav button, not the "Today's Kool Kalls" heading).
    await page
      .getByRole('button', { name: /Kool Kall/i })
      .first()
      .click()
      .catch(() => undefined);

    // Open the CreateKallModal via the cursor-pointer `.create_font`. Wait for it, and retry the open
    // once if the first click does not surface the modal (the SPA occasionally swallows the first tap).
    const modal = page.locator('.modal-content');
    const titleField = modal.locator('input[placeholder="Enter Meeting Title"]').first();
    const createBtn = page.locator('.create_font').first();
    await expect(createBtn, 'the Create control is present on the Kool Kall tab').toBeVisible({
      timeout: 20_000,
    });
    await createBtn.click({ force: true });
    if (!(await titleField.isVisible().catch(() => false))) {
      await createBtn.click({ force: true });
    }
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
    await modal
      .getByText(/Invite Participants/i)
      .first()
      .click({ force: true });
    await expect(
      page.getByText(/^Qa Tester2$/i).first(),
      'the participant picker lists selectable contacts',
    ).toBeVisible({ timeout: 15_000 });
  });
});
