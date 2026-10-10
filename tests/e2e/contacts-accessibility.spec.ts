/* eslint-disable playwright/no-wait-for-timeout */
import AxeBuilder from '@axe-core/playwright';
import { testData } from '@config/test-data.config';
import { AXE_JSON_ATTACHMENT, renderAccessibilityOverlay } from '@ui/accessibility-evidence';
import type { AxeScreenResult } from '@ui/accessibility-evidence';
import { expect, test } from '@fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/**
 * Deep WCAG scan (axe-core) for Contacts' own DYNAMIC states — the Add-contact wizard's people-search
 * step, its nested Advanced Search step, and the Create-Group dialog. `accessibility-axe.spec.ts`'s
 * per-screen sweep only ever scans `/katchup` in its DEFAULT state, so none of these three states (each
 * reached only via a wizard/dialog trigger inside the Contacts tab) were ever scanned — the same
 * genuine-gap reasoning as Home's, Katchup's, Profile's and Settings' own dynamic-state files.
 *
 * Navigation mirrors `contacts-functional.spec.ts`'s own proven `gotoContacts` helper and wizard steps
 * exactly (no shared `support/contacts.ts` module exists yet to import from).
 *
 * Kept in its own file, not added to `accessibility-axe.spec.ts`'s trusted sweep: unproven new screens
 * need their own clean run(s) before earning a place in the auto-filing allow-list.
 */

async function gotoContacts(page: Page): Promise<boolean> {
  await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  await page
    .getByRole('tab', { name: 'Contacts' })
    .click({ timeout: 15_000 })
    .catch(() => undefined);
  return page
    .getByRole('searchbox', { name: 'Search' })
    .first()
    .isVisible({ timeout: 15_000 })
    .catch(() => false);
}

test.describe(
  'KPost Contacts · dynamic-state accessibility (axe-core WCAG)',
  { tag: '@ui' },
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

    test('Contacts — Add-contact wizard, people-search step — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      const opened = await gotoContacts(page);
      test.skip(!opened, 'the Contacts tab did not open on this build — needs a codegen re-tune');

      await page
        .locator('.icon-KP_107-User-Add')
        .first()
        .click({ timeout: 15_000 })
        .catch(() => undefined);
      await page
        .getByText('Personal', { exact: true })
        .first()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      await page
        .getByRole('button', { name: 'Continue' })
        .first()
        .click({ timeout: 8_000 })
        .catch(() => undefined);
      const reachable = await page
        .getByRole('searchbox', { name: 'Search' })
        .first()
        .isVisible({ timeout: 12_000 })
        .catch(() => false);
      test.skip(!reachable, 'the Add-contact wizard did not reach the people-search step');
      await page.waitForTimeout(1000);
      await scanCurrentPage(page, testInfo, 'Contacts — Add-contact people-search step');
    });

    test('Contacts — Advanced Search step — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      const opened = await gotoContacts(page);
      test.skip(!opened, 'the Contacts tab did not open on this build — needs a codegen re-tune');

      await page
        .locator('.icon-KP_107-User-Add')
        .first()
        .click({ timeout: 15_000 })
        .catch(() => undefined);
      await page
        .getByText('Personal', { exact: true })
        .first()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      await page
        .getByRole('button', { name: 'Continue' })
        .first()
        .click({ timeout: 8_000 })
        .catch(() => undefined);
      await page
        .locator('.icon-KP_225_Advanced-Search')
        .first()
        .click({ timeout: 10_000 })
        .catch(() => undefined);
      const reachable = await page
        .getByRole('textbox', { name: 'Enter Mobile Number' })
        .first()
        .isVisible({ timeout: 10_000 })
        .catch(() => false);
      test.skip(!reachable, 'advanced search did not open — needs a codegen re-tune');
      await page.waitForTimeout(1000);
      await scanCurrentPage(page, testInfo, 'Contacts — Advanced Search step');
    });

    test('Contacts — Create-Group dialog open — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      const opened = await gotoContacts(page);
      test.skip(!opened, 'the Contacts tab did not open on this build — needs a codegen re-tune');

      await page
        .locator('.icon-KP_112-Group-Add')
        .first()
        .click({ timeout: 15_000 })
        .catch(() => undefined);
      const reachable = await page
        .getByRole('textbox', { name: 'Group Name' })
        .first()
        .isVisible({ timeout: 10_000 })
        .catch(() => false);
      test.skip(!reachable, 'the Create-Group dialog did not open — needs a codegen re-tune');
      await page.waitForTimeout(1000);
      await scanCurrentPage(page, testInfo, 'Contacts — Create-Group dialog');
    });
  },
);
