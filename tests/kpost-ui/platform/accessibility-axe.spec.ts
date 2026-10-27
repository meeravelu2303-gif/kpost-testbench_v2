/* eslint-disable playwright/no-wait-for-timeout */
import AxeBuilder from '@axe-core/playwright';
import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import {
  AXE_DETAILS_ATTACHMENT,
  AXE_JSON_ATTACHMENT,
  axeDetailsText,
  renderAccessibilityOverlay,
} from '@ui/accessibility-evidence';
import type { AxeScreenResult } from '@ui/accessibility-evidence';
import { expect, test } from '@fixtures';
import { writeFileSync } from 'node:fs';
import { skipIfSignedOut } from '../support/session';

/**
 * axe-core WCAG scan of every signed-in screen; soft-asserts zero critical/serious violations. The JSON
 * attachment lets the filing pipeline file one ticket per WCAG rule across all screens.
 */
test.describe(
  'KPost accessibility (axe-core WCAG) — every screen',
  {
    tag: ['@ui', '@platform', '@regression'],
    annotation: [{ type: 'non-functional', description: 'accessibility' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real account (QA_KPOST_ID)',
    );

    test.beforeEach(async ({ page }) => {
      await skipIfSignedOut(page);
    });

    for (const screen of AUTHENTICATED_SCREENS) {
      test(`${screen.name} — WCAG violations (axe) @ui`, async ({ page }, testInfo) => {
        await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(1200);

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();

        const by = (impact: string) => results.violations.filter((v) => v.impact === impact);
        const critical = by('critical');
        const serious = by('serious');
        const summary = results.violations
          .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.length}× — ${v.help}`)
          .join('\n');

        await testInfo.attach(`axe-${screen.name}.txt`, {
          body: summary || 'no violations',
          contentType: 'text/plain',
        });

        // Evidence for the filing pipeline: only the critical/serious tiers the assertions gate on.
        const evidence: AxeScreenResult = {
          screen: screen.name,
          route: screen.route,
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
        // Every failing element with selector, HTML and (for contrast) colours + ratio, for the ticket.
        if (critical.length + serious.length) {
          const detailsPath = testInfo.outputPath('a11y-details.txt');
          writeFileSync(detailsPath, axeDetailsText(screen.name, [...critical, ...serious]));
          await testInfo.attach(AXE_DETAILS_ATTACHMENT, {
            path: detailsPath,
            contentType: 'text/plain',
          });
        }

        // Paint the violations onto the page so the screenshot and failure video show them.
        if (evidence.violations.length) {
          await renderAccessibilityOverlay(page, screen.name, evidence.violations);
          const overlayPath = testInfo.outputPath('a11y-evidence.png');
          await page.screenshot({ path: overlayPath }).catch(() => undefined);
          await testInfo.attach('a11y-evidence', { path: overlayPath, contentType: 'image/png' });
          await page
            .locator('#__kp_a11y_overlay')
            .waitFor({ state: 'detached', timeout: 4_000 })
            .catch(() => undefined);
        }

        console.log(
          `[a11y] ${screen.name}: ${critical.length} critical, ${serious.length} serious, ${results.violations.length} total`,
        );

        // Soft so one screen's issues don't hide another's; only the worst tiers gate visibility.
        expect
          .soft(
            critical,
            `${screen.name}: critical WCAG violations — ${critical.map((v) => v.id).join(', ')}`,
          )
          .toEqual([]);
        expect
          .soft(
            serious,
            `${screen.name}: serious WCAG violations — ${serious.map((v) => v.id).join(', ')}`,
          )
          .toEqual([]);
      });
    }
  },
);
