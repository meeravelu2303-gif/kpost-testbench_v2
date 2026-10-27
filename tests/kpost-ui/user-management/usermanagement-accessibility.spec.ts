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
} from '../support/usermanagement';

/**
 * axe-core WCAG scan of User Management's modals: the Add Channels chooser and the untouched Add
 * Manually form (never submitted). Kept out of the trusted a11y sweep until it has clean runs.
 */
test.describe(
  'KPost User Management · dynamic-state accessibility (axe-core WCAG, BUSINESS_S)',
  {
    tag: ['@ui', '@user-management', '@regression'],
    annotation: [{ type: 'non-functional', description: 'accessibility' }],
  },
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

    /** Scoped to the open modal: the page behind it is the per-screen sweep's job. */
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
      // Let the fade-in finish before axe measures contrast; scoped to the chooser because the page
      // behind it has a looping animation.
      await settleAnimations(page.locator('.modal.show, [role="dialog"]').last());
      await scanCurrentPage(page, testInfo, 'User Management — Add Channels chooser');
    });

    test('User Management — Add Manually member-form modal open — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      // Fails (not skips) if the form does not open; also waits for the fade to finish.
      await openAddMemberForm(page);
      await scanCurrentPage(page, testInfo, 'User Management — Add Manually form');
    });
  },
);
