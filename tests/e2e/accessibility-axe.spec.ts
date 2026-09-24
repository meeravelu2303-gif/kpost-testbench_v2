/* eslint-disable playwright/no-wait-for-timeout */
import AxeBuilder from '@axe-core/playwright';
import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { AXE_JSON_ATTACHMENT, renderAccessibilityOverlay } from '@ui/accessibility-evidence';
import type { AxeScreenResult } from '@ui/accessibility-evidence';
import { expect, test } from '@fixtures';
import { writeFileSync } from 'node:fs';
import { skipIfSignedOut } from './support/session';

/**
 * Deep WCAG accessibility angle — axe-core runs the full ruleset (colour contrast, ARIA validity,
 * roles, names, landmarks, …) on every screen, far beyond the alt/label/lang/title the built-in
 * `ui.accessibility` check covers.
 *
 * Each screen still SOFT-asserts zero critical/serious violations, so a run stays green-by-default
 * and one screen's issues never hide another's. What changed: alongside the human-readable summary,
 * each screen now attaches a STRUCTURED JSON report (`AXE_JSON_ATTACHMENT`) that the bug-filing
 * pipeline reads back. It groups violations by RULE across every screen — the same collapse used for
 * the platform-wide API findings — so one ticket per WCAG rule lists every screen it hit, instead of
 * one ticket per screen flooding the queue with near-duplicates of the same rule.
 */
test.describe('KPost accessibility (axe-core WCAG) — every screen', { tag: '@ui' }, () => {
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

      // Structured evidence for the filing pipeline: only the tiers the assertions below gate on
      // (critical/serious) — a moderate/minor finding is real but not fileable at this bar.
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

      // A WCAG violation is a static property (missing alt text, low contrast, …) — nothing visibly
      // changes on the page, so a plain screenshot/video would show nothing wrong and the recorded
      // video would just be an unremarkable, unchanging screen for its whole length. Painting the
      // violations onto the page turns BOTH into real evidence: this screenshot shows them directly,
      // and holding the overlay means Playwright's own on-failure screenshot/video (captured at test
      // end) also ends on this readable report instead of a blank page.
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
});
