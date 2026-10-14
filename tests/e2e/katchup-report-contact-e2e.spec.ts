import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';
import { openConversation } from './support/katchup';

/**
 * Report Contact (Katchup → a contact's Digital Card → Report) — the last uncovered Katchup report
 * surface. There is NO message-level report in the live (bubble) app: the only report flow is the
 * Digital Card's "Report Contact" (DigitalCard.js featureButtons, `aria-label="Report Contact"`, or the
 * card footer's "Report" link), which opens ReportContact.js.
 *
 * Read directly from source (bubble/ReportContact/ReportContact.js):
 *   - the dialog lists abuse reasons as checkboxes (`name="Check"`) and one "Block this Contact in my
 *     KPOST & Clear the Data" checkbox (`name="mainCheck"`);
 *   - Confirm is disabled until that block box is ticked;
 *   - Confirm (`confirmbutton`) only closes the dialog — it calls NO service at all. That is the open
 *     bug **#966** [KP-REPORTCONTACT-NOOP].
 *
 * Target: qatest3, NOT the victim account (qatest2). Confirm sits behind "Block this Contact & Clear
 * the Data", so if a newer build really does block and clear, it must not wipe the qatest1↔qatest2
 * thread every other Katchup spec relies on. The confirm test unblocks qatest3 again afterwards.
 */
const REPORT_TARGET_CONTACT_ID = 'qatest3@kpostindia.com';

test.describe(
  'KPost Katchup · Report Contact @ui',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs the primary QA account',
    );

    /** Open qatest3's Digital Card from its thread header avatar (same trigger as digitalcard-share). */
    async function openDigitalCard(page: Page): Promise<void> {
      await openConversation(page, REPORT_TARGET_CONTACT_ID);
      await page
        .locator('.background-color-katchup')
        .locator('.font-Family-Nunito')
        .first()
        .click({ timeout: 15_000 });
      await expect(
        page.getByText('View Profile', { exact: true }).first(),
        'the Digital Card opens',
      ).toBeVisible({ timeout: 15_000 });
    }

    /** Open qatest3's Digital Card and return its Report trigger. */
    async function openReportTrigger(page: Page): Promise<Locator> {
      await openDigitalCard(page);
      const trigger = page
        .getByRole('button', { name: 'Report Contact', exact: true })
        .or(page.locator('.dc-footer-link', { hasText: /^Report$/ }))
        .first();
      await expect(trigger, 'the Digital Card offers Report for a personal contact').toBeVisible({
        timeout: 10_000,
      });
      return trigger;
    }

    const reportDialog = (page: Page) =>
      page.getByRole('dialog').filter({ hasText: 'Report Contact' });

    test('the Report dialog lists reasons and keeps Confirm disabled until the block box is ticked @ui', async ({
      page,
    }) => {
      // Read-only: opens the dialog and cancels — never confirms.
      await (await openReportTrigger(page)).click();
      const dialog = reportDialog(page);
      await expect(dialog, 'the Report Contact dialog opens').toBeVisible({ timeout: 10_000 });

      const reasons = dialog.locator('input[name="Check"]');
      expect(
        await reasons.count(),
        'the dialog lists abuse reasons to choose from',
      ).toBeGreaterThan(0);
      await reasons.first().click();
      await expect(reasons.first(), 'a reason can be ticked').toBeChecked();

      const confirm = dialog.getByRole('button', { name: /^Confirm$/i });
      await expect(
        confirm,
        'Confirm stays disabled while the block box is unticked',
      ).toBeDisabled();
      await dialog.locator('input[name="mainCheck"]').click();
      await expect(confirm, 'ticking the block box enables Confirm').toBeEnabled();

      await dialog.getByRole('button', { name: /^Cancel$/i }).click();
      await expect(dialog, 'Cancel closes the dialog').toBeHidden({ timeout: 10_000 });
    });

    test('confirming a report actually sends it to the server @ui', async ({ page }) => {
      test.skip(
        process.env.KATCHUP_UI_LIFECYCLE !== 'true',
        'confirms a real report (and may block qatest3); set KATCHUP_UI_LIFECYCLE=true',
      );
      // Correct behaviour asserted on purpose: a report the user confirms must reach the server. Today it
      // does not (#966, open) — this test is the live re-verification of that bug, so it fails until
      // #966 is fixed.
      try {
        await (await openReportTrigger(page)).click();
        const dialog = reportDialog(page);
        await expect(dialog, 'the Report Contact dialog opens').toBeVisible({ timeout: 10_000 });
        await dialog.locator('input[name="Check"]').first().click();
        await dialog.locator('input[name="mainCheck"]').click();

        // Any non-GET call that names a report/block/abuse action counts as "sent to the server".
        const reportCall = page
          .waitForRequest((r) => r.method() !== 'GET' && /report|block|abuse|spam/i.test(r.url()), {
            timeout: 8_000,
          })
          .catch(() => null);
        await dialog.getByRole('button', { name: /^Confirm$/i }).click();
        const sent = await reportCall;

        await expect(dialog, 'Confirm closes the dialog').toBeHidden({ timeout: 10_000 });
        test.info().annotations.push({
          type: 'observed',
          description: sent
            ? `report request sent: ${sent.method()} ${sent.url()}`
            : 'no report/block request was sent within 8s of Confirm (#966)',
        });
        expect(
          sent?.url() ?? null,
          'confirming Report Contact sends a report to the server (#966: today it sends nothing)',
        ).not.toBeNull();
      } finally {
        // Self-restore: if a build ever does block on confirm, reopen the card and unblock qatest3.
        await openDigitalCard(page).catch(() => undefined);
        const unblock = page.getByRole('button', { name: 'Unblock Contact', exact: true });
        if (await unblock.isVisible().catch(() => false)) {
          await unblock.click().catch(() => undefined);
        }
      }
    });
  },
);
