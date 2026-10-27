/* eslint-disable playwright/no-wait-for-timeout */
import AxeBuilder from '@axe-core/playwright';
import { testData } from '@config/test-data.config';
import { AXE_JSON_ATTACHMENT, renderAccessibilityOverlay } from '@ui/accessibility-evidence';
import type { AxeScreenResult } from '@ui/accessibility-evidence';
import { expect, test } from '@fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/**
 * axe-core WCAG scan of Profile's dynamic states (three-dot menu open, Share modal open), which the
 * per-screen sweep in accessibility-axe.spec.ts does not reach.
 */
test.describe(
  'KPost Profile · dynamic-state accessibility (axe-core WCAG)',
  {
    tag: ['@ui', '@profile', '@regression'],
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
        route: '/userprofile',
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

    test('Profile — three-dot action menu open — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

      await page.locator('.icon-KP_144---More-Vertical').first().click();
      await expect(
        page.getByText(/Change (Cover|Profile) Picture|Share|Logout/i).first(),
        'the three-dot menu opens',
      ).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1000);
      await scanCurrentPage(page, testInfo, 'Profile — three-dot menu open');
    });

    test('Profile — Share modal open — WCAG violations (axe) @ui', async ({ page }, testInfo) => {
      await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

      await page.locator('.icon-KP_144---More-Vertical').first().click();
      await page
        .getByText(/^Share$/i)
        .first()
        .click();
      // .first() wraps the combined .or(): the dialog and .modal-content both exist at once.
      await expect(
        page.getByRole('dialog').or(page.locator('.modal-content')).first(),
        'the Share modal opens',
      ).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1000);
      await scanCurrentPage(page, testInfo, 'Profile — Share modal open');
    });
  },
);
