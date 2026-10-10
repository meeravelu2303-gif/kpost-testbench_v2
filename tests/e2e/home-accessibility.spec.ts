/* eslint-disable playwright/no-wait-for-timeout */
import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { AXE_JSON_ATTACHMENT, renderAccessibilityOverlay } from '@ui/accessibility-evidence';
import type { AxeScreenResult } from '@ui/accessibility-evidence';
import { expect, test } from '@fixtures';
import { writeFileSync } from 'node:fs';

/**
 * Deep WCAG scan (axe-core) for Home's own DYNAMIC states — the Contacts tab active, and the
 * Advanced Search modal open. `accessibility-axe.spec.ts`'s per-screen sweep only ever scans Home in
 * its DEFAULT state (Recents tab, no modal), so these two states were never scanned at all, the same
 * genuine-gap reasoning as Signup/Login's own post-OTP screens.
 *
 * Kept in its own file, not added to `accessibility-axe.spec.ts`'s trusted sweep: unproven new
 * screens need their own clean run(s) before earning a place in the auto-filing allow-list.
 */
test.describe('KPost Home · dynamic-state accessibility (axe-core WCAG)', { tag: '@ui' }, () => {
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
      route: '/home',
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

  test('Home — Contacts tab active — WCAG violations (axe) @ui', async ({
    page,
    homePage,
  }, testInfo) => {
    await homePage.goto();
    await homePage.switchToContactsTab();
    await page.waitForTimeout(1200);
    await scanCurrentPage(page, testInfo, 'Home — Contacts tab');
  });

  test('Home — Advanced Search modal open — WCAG violations (axe) @ui', async ({
    page,
    homePage,
  }, testInfo) => {
    await homePage.goto();
    await homePage.switchToRecentsTab();
    await homePage.openAdvancedSearch();
    await page.waitForTimeout(1200);
    await scanCurrentPage(page, testInfo, 'Home — Advanced Search modal');
  });
});
