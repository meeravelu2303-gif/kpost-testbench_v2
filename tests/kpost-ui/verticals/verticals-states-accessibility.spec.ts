import AxeBuilder from '@axe-core/playwright';
import { testData } from '@config/test-data.config';
import {
  AXE_DETAILS_ATTACHMENT,
  AXE_JSON_ATTACHMENT,
  axeDetailsText,
  renderAccessibilityOverlay,
} from '@ui/accessibility-evidence';
import type { AxeScreenResult } from '@ui/accessibility-evidence';
import { expect, test } from '@fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { skipIfSignedOut } from '../support/session';
import { settleAnimations } from '../support/usermanagement';

/**
 * axe-core WCAG scan of the vertical screens' own states that the per-screen sweep
 * (platform-axe-accessibility.spec.ts, which loads each route once) does not reach: the KDiary Add
 * schedule modal (opened, never saved), KBooking's city picker and My Trips list, the KNews World
 * panel, and the KDirectory vertical chooser. Read-only: nothing is saved, booked or sent.
 */
test.describe(
  'KPost Verticals · dynamic-state accessibility (axe-core WCAG)',
  {
    tag: ['@ui', '@verticals', '@regression'],
    annotation: [{ type: 'non-functional', description: 'accessibility' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test.beforeEach(async ({ page }) => {
      await skipIfSignedOut(page);
    });

    const OPEN_MODAL = '.modal.show, [role="dialog"]';

    async function open(page: Page, route: string): Promise<void> {
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
    }

    async function scan(
      page: Page,
      testInfo: TestInfo,
      screenName: string,
      route: string,
      include?: string,
    ): Promise<void> {
      let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
      if (include) builder = builder.include(include);
      const results = await builder.analyze();

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
        route,
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
      if (critical.length + serious.length) {
        const detailsPath = testInfo.outputPath('a11y-details.txt');
        writeFileSync(detailsPath, axeDetailsText(screenName, [...critical, ...serious]));
        await testInfo.attach(AXE_DETAILS_ATTACHMENT, {
          path: detailsPath,
          contentType: 'text/plain',
        });
      }

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

    test('KDiary — Add schedule modal open (never saved) — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      await open(page, '/kdiary');
      await expect(
        page.getByText('Diary', { exact: true }).first(),
        'the Diary panel renders',
      ).toBeVisible({ timeout: 20_000 });
      await page
        .getByRole('button', { name: /\+ ?Add/ })
        .first()
        .click();
      const modal = page.locator(OPEN_MODAL).last();
      await expect(modal, 'the KDiary add modal opens').toBeVisible({ timeout: 10_000 });
      await expect(page.getByPlaceholder('Enter Title'), 'the Title field renders').toBeVisible();
      await settleAnimations(modal);
      await scan(page, testInfo, 'KDiary — Add schedule modal', '/kdiary', OPEN_MODAL);
      await page.keyboard.press('Escape');
    });

    test('KBooking — From-city suggestions open — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      await open(page, '/kbooking');
      const from = page.locator('.react-select__control').first();
      await expect(from, 'the From-city field renders').toBeVisible({ timeout: 15_000 });
      await from.click();
      await page.keyboard.type('Bang');
      await page
        .locator('.react-select__menu')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .catch(() => undefined);
      await scan(page, testInfo, 'KBooking — From-city suggestions', '/kbooking');
    });

    test('KBooking — My Trips list (Upcoming / Completed / Cancelled) — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      await open(page, '/kbooking');
      await page
        .getByText(/My Trips/i)
        .first()
        .click();
      await expect(
        page
          .getByRole('tab', { name: /Upcoming/i })
          .or(page.getByText(/Upcoming/i))
          .first(),
        'the My Trips list renders',
      ).toBeVisible({ timeout: 15_000 });
      await scan(page, testInfo, 'KBooking — My Trips', '/kbooking');
    });

    test('KNews — World country panel open — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      await open(page, '/knews');
      await expect(
        page.getByPlaceholder(/Search headlines/i).first(),
        'the KNews screen renders',
      ).toBeVisible({ timeout: 30_000 });
      await page
        .getByText(/^World$/i)
        .first()
        .click();
      await expect(
        page.getByPlaceholder(/Filter countries/i).first(),
        'the World panel opens',
      ).toBeVisible({ timeout: 15_000 });
      await scan(page, testInfo, 'KNews — World panel', '/knews');
    });

    test('KDirectory — vertical chooser after Country and Language — WCAG violations (axe) @ui', async ({
      page,
    }, testInfo) => {
      await open(page, '/kdirectory');
      const pick = async (placeholder: RegExp, option: string) => {
        const control = page
          .locator('.react-select__control')
          .filter({ hasText: placeholder })
          .first();
        await expect(control, `the "${placeholder.source}" selector renders`).toBeVisible({
          timeout: 15_000,
        });
        await control.locator('input').first().fill(option);
        const match = page
          .locator('.react-select__option')
          .filter({ hasText: new RegExp(option, 'i') })
          .first();
        await expect(match, `"${option}" is offered`).toBeVisible({ timeout: 15_000 });
        await match.click();
      };
      await pick(/Select Country/i, 'India');
      await pick(/Choose Language/i, 'English');
      await expect(
        page.locator('.dirCategory-box, .selectedCategory-box').first(),
        'the vertical chooser renders',
      ).toBeVisible({ timeout: 15_000 });
      await scan(page, testInfo, 'KDirectory — vertical chooser', '/kdirectory');
    });
  },
);
