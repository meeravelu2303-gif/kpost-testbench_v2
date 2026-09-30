/* eslint-disable playwright/no-wait-for-timeout */
import AxeBuilder from '@axe-core/playwright';
import { testData } from '@config/test-data.config';
import { AXE_JSON_ATTACHMENT, renderAccessibilityOverlay } from '@ui/accessibility-evidence';
import type { AxeScreenResult } from '@ui/accessibility-evidence';
import { expect, test } from '@fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/**
 * Deep WCAG scan (axe-core) for Kall's own DYNAMIC states — the Kool Kall tab active, and the
 * CreateKallModal (schedule form) open. `accessibility-axe.spec.ts`'s per-screen sweep only ever
 * scans `/kall` in its DEFAULT state (`src/ui/screens.ts`), so neither state was ever scanned — the
 * same genuine-gap reasoning as Home's, Katchup's, Profile's, Settings' and Contacts' own
 * dynamic-state files.
 *
 * Navigation reuses `kall-features.spec.ts`'s own proven selectors for reaching each state; it never
 * completes Submit (blocked on a codegen-pending participant-picker step, same as that file).
 *
 * Kept in its own file, not added to `accessibility-axe.spec.ts`'s trusted sweep: unproven new screens
 * need their own clean run(s) before earning a place in the auto-filing allow-list.
 */
test.describe('KPost Kall · dynamic-state accessibility (axe-core WCAG)', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  async function scanCurrentPage(page: Page, testInfo: TestInfo, screenName: string): Promise<void> {
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
      route: '/kall',
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
    await testInfo.attach(AXE_JSON_ATTACHMENT, { path: evidencePath, contentType: 'application/json' });

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
      .soft(critical, `${screenName}: critical WCAG violations — ${critical.map((v) => v.id).join(', ')}`)
      .toEqual([]);
    expect
      .soft(serious, `${screenName}: serious WCAG violations — ${serious.map((v) => v.id).join(', ')}`)
      .toEqual([]);
  }

  test('Kall — Kool Kall tab active — WCAG violations (axe) @ui', async ({ page }, testInfo) => {
    await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .getByRole('button', { name: /Kool Kall/i })
      .first()
      .click()
      .catch(() => undefined);
    await expect(page.getByText(/Kool Kall/i).first(), 'the Kool Kall tab is present').toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(1000);
    await scanCurrentPage(page, testInfo, 'Kall — Kool Kall tab active');
  });

  test('Kall — schedule modal (CreateKallModal) open — WCAG violations (axe) @ui', async ({
    page,
  }, testInfo) => {
    await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .getByRole('button', { name: /Kool Kall/i })
      .first()
      .click()
      .catch(() => undefined);

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
    const opened = await titleField.isVisible({ timeout: 15_000 }).catch(() => false);
    test.skip(!opened, 'the schedule modal did not open on this build — needs a codegen re-tune');

    await page.waitForTimeout(1000);
    await scanCurrentPage(page, testInfo, 'Kall — schedule modal open');
  });
});
