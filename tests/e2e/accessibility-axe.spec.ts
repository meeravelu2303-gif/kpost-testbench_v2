/* eslint-disable playwright/no-wait-for-timeout */
import AxeBuilder from '@axe-core/playwright';
import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from './support/session';

/**
 * Deep WCAG accessibility angle — axe-core runs the full ruleset (colour contrast, ARIA validity,
 * roles, names, landmarks, …) on every screen, far beyond the alt/label/lang/title the built-in
 * `ui.accessibility` check covers.
 *
 * Deliberately NOT in `UI_FILING_SPECS`: a11y violations are numerous and the same rule repeats
 * across screens, so auto-filing would flood the queue. Instead each screen ATTACHES its full axe
 * report (for the developer to triage) and SOFT-asserts zero **critical/serious** violations — so the
 * worst offenders are visible in the run without opening dozens of near-duplicate tickets. Promote a
 * confirmed one to Bugzilla by hand.
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
      console.log(
        `[a11y] ${screen.name}: ${critical.length} critical, ${serious.length} serious, ${results.violations.length} total`,
      );

      // Soft so one screen's issues don't hide another's; only the worst tiers gate visibility.
      expect
        .soft(critical, `${screen.name}: critical WCAG violations — ${critical.map((v) => v.id).join(', ')}`)
        .toEqual([]);
      expect
        .soft(serious, `${screen.name}: serious WCAG violations — ${serious.map((v) => v.id).join(', ')}`)
        .toEqual([]);
    });
  }
});
