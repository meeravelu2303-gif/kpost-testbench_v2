/* eslint-disable playwright/no-wait-for-timeout */
import AxeBuilder from '@axe-core/playwright';
import { testData } from '@config/test-data.config';
import { AXE_JSON_ATTACHMENT, renderAccessibilityOverlay } from '@ui/accessibility-evidence';
import type { AxeScreenResult } from '@ui/accessibility-evidence';
import { expect, test } from '@fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/**
 * Axe WCAG scan of Settings with a nav group expanded (the sweep only scans the collapsed default).
 * Kept out of the trusted auto-filing sweep until it has proven clean runs.
 */
test.describe(
  'KPost Settings · dynamic-state accessibility (axe-core WCAG)',
  {
    tag: ['@ui', '@settings', '@regression'],
    annotation: [{ type: 'non-functional', description: 'accessibility' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
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
        route: '/settings',
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

    async function gotoSettings(page: Page): Promise<void> {
      await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
    }

    test('Settings — General Settings expanded (Personalize, Notification) — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      await gotoSettings(page);
      await page
        .getByText(/General Settings/i)
        .first()
        .click();
      await expect(
        page.getByText(/^Personalize$/i).first(),
        'General Settings reveals Personalize',
      ).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1000);
      await scanCurrentPage(page, testInfo, 'Settings — General Settings expanded');
    });

    test('Settings — Profile Creation expanded (Basic Information) — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      await gotoSettings(page);
      await page
        .getByText(/Profile Creation/i)
        .first()
        .click();
      await expect(
        page.getByText(/Basic Information/i).first(),
        'Profile Creation reveals Basic Information',
      ).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1000);
      await scanCurrentPage(page, testInfo, 'Settings — Profile Creation expanded');
    });
  },
);
