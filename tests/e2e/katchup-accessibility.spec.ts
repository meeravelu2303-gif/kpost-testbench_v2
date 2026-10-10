/* eslint-disable playwright/no-wait-for-timeout */
import AxeBuilder from '@axe-core/playwright';
import { testData } from '@config/test-data.config';
import { AXE_JSON_ATTACHMENT, renderAccessibilityOverlay } from '@ui/accessibility-evidence';
import type { AxeScreenResult } from '@ui/accessibility-evidence';
import { expect, test } from '@fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { gotoKatchup, openConversation } from './support/katchup';

/**
 * Deep WCAG scan (axe-core) for Katchup's own DYNAMIC states — the conversation list, an open
 * conversation thread, and the composer with the Subject field focused. `accessibility-axe.spec.ts`'s
 * per-screen sweep never drives into a conversation or opens the composer, so these three states were
 * never scanned at all — the same genuine-gap reasoning as Home's own dynamic-state file.
 *
 * Navigation reuses the shared, validated `support/katchup` helpers rather than re-deriving the
 * loader-overlay-wait / conversation-row steps here.
 *
 * Kept in its own file, not added to `accessibility-axe.spec.ts`'s trusted sweep: unproven new screens
 * need their own clean run(s) before earning a place in the auto-filing allow-list.
 */

test.describe('KPost Katchup · dynamic-state accessibility (axe-core WCAG)', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts',
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
      route: '/katchup',
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

  test('Katchup — conversation list (default) — WCAG violations (axe) @ui', async ({
    page,
  }, testInfo) => {
    await gotoKatchup(page);
    await page.waitForTimeout(1200);
    await scanCurrentPage(page, testInfo, 'Katchup — conversation list');
  });

  test('Katchup — open conversation thread — WCAG violations (axe) @ui', async ({
    page,
  }, testInfo) => {
    await openConversation(page, testData.victimKpostId);
    await page.waitForTimeout(1200);
    await scanCurrentPage(page, testInfo, 'Katchup — open conversation');
  });

  test('Katchup — composer open, Subject focused — WCAG violations (axe) @ui', async ({
    page,
  }, testInfo) => {
    await openConversation(page, testData.victimKpostId);
    await page.locator('.msg-arrow').first().click();
    await page.getByRole('textbox', { name: 'Subject' }).click();
    await page.waitForTimeout(1200);
    await scanCurrentPage(page, testInfo, 'Katchup — composer open');
  });
});
