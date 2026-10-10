import AxeBuilder from '@axe-core/playwright';
import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { AXE_JSON_ATTACHMENT, renderAccessibilityOverlay } from '@ui/accessibility-evidence';
import type { AxeScreenResult } from '@ui/accessibility-evidence';
import { expect, test } from '@fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import {
  openAddChannelsChooser,
  openAddMemberForm,
  settleAnimations,
} from './support/usermanagement';

/**
 * Deep WCAG scan (axe-core) for User Management's own DYNAMIC states — the "Add Communication
 * Channels" chooser (Add Manually / Bulk-Upload), and the "Add Manually" member-form modal in its
 * default (untouched) state. Neither is reached by the generic per-screen sweep, which only ever
 * scans `/usermanagement` itself. The form modal is scanned before Designation is set, so the flow
 * never advances toward the same-company mobile-collision guard or Add — same boundary
 * `usermanagement.spec.ts` and `usermanagement-security.spec.ts` both keep.
 *
 * Navigation goes through `support/usermanagement.ts`, shared with the other two User Management
 * specs and re-tuned live on 2026-10-10 (no forced clicks, no fixed sleeps).
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

    /**
     * Scoped to the open modal. This spec exists for the form's OWN dynamic states; the page behind
     * it (`/usermanagement` with the Katchup Recent sidebar) is the per-screen sweep's job. Scanning
     * the whole page here re-reported the sidebar's known findings — an avatar with no alt text
     * (#1011) and the Recent name/date labels' contrast (#926, platform-wide #1022) — as if they
     * were defects of the Add Manually form. Found live 2026-10-10.
     */
    const OPEN_MODAL = '.modal.show, [role="dialog"]';

    async function scanCurrentPage(
      page: Page,
      testInfo: TestInfo,
      screenName: string,
    ): Promise<void> {
      const results = await new AxeBuilder({ page })
        .include(OPEN_MODAL)
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
      await openAddChannelsChooser(page);
      // Let the chooser's fade-in finish before axe measures colour contrast on it. Scoped to the
      // chooser itself: the page behind it has a looping animation that never "finishes".
      await settleAnimations(page.locator('.modal.show, [role="dialog"]').last());
      await scanCurrentPage(page, testInfo, 'User Management — Add Channels chooser');
    });

    test('User Management — Add Manually member-form modal open — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      // openAddMemberForm asserts the form and its Designation picker are up and waits for the
      // modal's fade to finish, so a form that fails to open is a failure here, not a silent skip.
      await openAddMemberForm(page);
      await scanCurrentPage(page, testInfo, 'User Management — Add Manually form');
    });
  },
);
