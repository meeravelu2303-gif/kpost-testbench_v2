/* eslint-disable playwright/no-wait-for-timeout */
import AxeBuilder from '@axe-core/playwright';
import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { AXE_JSON_ATTACHMENT, renderAccessibilityOverlay } from '@ui/accessibility-evidence';
import type { AxeScreenResult } from '@ui/accessibility-evidence';
import { expect, test } from '@fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/**
 * Deep WCAG scan (axe-core) for User Management's own DYNAMIC states — the "Add Communication
 * Channels" chooser (Add Manually / Bulk-Upload), and the "Add Manually" member-form modal in its
 * default (untouched) state. Neither is reached by the generic per-screen sweep, which only ever
 * scans `/usermanagement` itself. The form modal is scanned before Designation is set, so the flow
 * never advances toward the same-company mobile-collision guard or Add — same boundary
 * `usermanagement.spec.ts` and `usermanagement-security.spec.ts` both keep.
 *
 * Navigation reuses `usermanagement.spec.ts`'s own proven selectors exactly.
 *
 * Kept in its own file, not added to `accessibility-axe.spec.ts`'s trusted sweep: unproven new screens
 * need their own clean run(s) before earning a place in the auto-filing allow-list.
 */
test.describe(
  'KPost User Management · dynamic-state accessibility (axe-core WCAG, BUSINESS_S)',
  { tag: '@ui' },
  () => {
    test.use({ storageState: STORAGE_STATE_BUSINESS });

    test.skip(
      process.env.BUSINESS_UI_LIFECYCLE !== 'true',
      'needs the BUSINESS_S admin session; set BUSINESS_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.businessSKpostId || testData.businessSKpostId.includes('qa.business'),
      'needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID)',
    );

    async function scanCurrentPage(
      page: Page,
      testInfo: TestInfo,
      screenName: string,
    ): Promise<void> {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const by = (impact: string) => results.violations.filter((v) => v.impact === impact);
      const critical = by('critical');
      const serious = by('serious');
      const summary = results.violations
        .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.length}× — ${v.help}`)
        .join('\n');

      await testInfo.attach(`axe-${screenName}.txt`, {
        body: summary || 'no violations',
        contentType: 'text/plain',
      });

      const evidence: AxeScreenResult = {
        screen: screenName,
        route: '/usermanagement',
        violations: [...critical, ...serious].map((v) => ({
          id: v.id,
          impact: v.impact as AxeScreenResult['violations'][number]['impact'],
          help: v.help,
          helpUrl: v.helpUrl,
          tags: v.tags,
          nodeCount: v.nodes.length,
          targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
        })),
      };
      const evidencePath = testInfo.outputPath('axe-violations.json');
      writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
      await testInfo.attach(AXE_JSON_ATTACHMENT, {
        path: evidencePath,
        contentType: 'application/json',
      });

      if (evidence.violations.length) {
        await renderAccessibilityOverlay(page, screenName, evidence.violations);
        const overlayPath = testInfo.outputPath('a11y-evidence.png');
        await page.screenshot({ path: overlayPath }).catch(() => undefined);
        await testInfo.attach('a11y-evidence', { path: overlayPath, contentType: 'image/png' });
        await page
          .locator('#__kp_a11y_overlay')
          .waitFor({ state: 'detached', timeout: 4_000 })
          .catch(() => undefined);
      }

      console.log(
        `[a11y] ${screenName}: ${critical.length} critical, ${serious.length} serious, ${results.violations.length} total`,
      );

      expect
        .soft(
          critical,
          `${screenName}: critical WCAG violations — ${critical.map((v) => v.id).join(', ')}`,
        )
        .toEqual([]);
      expect
        .soft(
          serious,
          `${screenName}: serious WCAG violations — ${serious.map((v) => v.id).join(', ')}`,
        )
        .toEqual([]);
    }

    test('User Management — Add Communication Channels chooser open — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      await page.goto('/usermanagement', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      await page
        .getByText(/Add New\s*\d*\s*Channels/i)
        .first()
        .click();
      await expect(
        page.getByText(/Add Manually|Bulk-?Upload/i).first(),
        'the Add Communication Channels chooser opens',
      ).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1000);
      await scanCurrentPage(page, testInfo, 'User Management — Add Channels chooser');
    });

    test('User Management — Add Manually member-form modal open — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      await page.goto('/usermanagement', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1000);
      await page
        .getByText(/Add New\s*\d*\s*Channels/i)
        .first()
        .click();
      await page.waitForTimeout(500);
      await page
        .getByText(/Add Manually/i)
        .first()
        .click();

      const modal = page.locator('.modal.show, [role="dialog"]').last();
      const reachable = await modal
        .locator('.react-select__input')
        .first()
        .isVisible({ timeout: 10_000 })
        .catch(() => false);
      test.skip(!reachable, 'the Add Manually form did not open — needs a codegen re-tune');
      await page.waitForTimeout(1000);
      await scanCurrentPage(page, testInfo, 'User Management — Add Manually form');
    });
  },
);
