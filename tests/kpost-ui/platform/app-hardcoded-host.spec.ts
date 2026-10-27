import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * Hard-coded host guard: no request a screen makes on load may target a host outside the test build's
 * config (devapi2, a 192.168.x box, the prod admin host). A failure lists the offending URLs.
 */
test.describe(
  'KPost · no hard-coded (non-configured) hosts on load',
  {
    tag: ['@ui', '@platform', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a live QA account',
    );

    // Hosts that must NEVER appear in a request on the test build. testkmail/testingapi are the
    // legitimate configured hosts and are deliberately NOT listed.
    const FORBIDDEN =
      /:\/\/(devapi2\.kpostindia\.com|(?:\d{1,3}\.){3}\d{1,3}|kpostadmin\.kpostindia\.com)/i;

    /** Navigate to `route`, let it settle, and return the distinct non-configured hosts it requested. */
    async function forbiddenRequests(page: Page, route: string): Promise<string[]> {
      const bad = new Set<string>();
      page.on('request', (r) => {
        const url = r.url();
        if (FORBIDDEN.test(url)) {
          // Normalise: drop the query and any trailing id so the annotation is readable.
          bad.add((url.split('?')[0] ?? url).replace(/\/[^/]+$/, '/…'));
        }
      });
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
      await settleFrames(page).catch(() => undefined);
      return [...bad];
    }

    for (const { name, route } of [
      { name: 'Home', route: '/home' },
      { name: 'Katchup', route: '/katchup' },
      { name: 'Kall', route: '/kall' },
      { name: 'Profile', route: '/userprofile' },
    ]) {
      test(`${name} makes no request to a hard-coded non-configured host @ui`, async ({ page }) => {
        const bad = await forbiddenRequests(page, route);
        test.info().annotations.push({
          type: 'observed',
          description: bad.length
            ? `${name} requested non-configured hosts: ${bad.join(' , ')}`
            : `${name} used only configured hosts`,
        });
        expect(
          bad,
          `${name} must request only the configured test hosts; these bypass ServiceURL and break on ` +
            `test (and point at the wrong environment on prod): ${bad.join(' , ')}`,
        ).toEqual([]);
      });
    }
  },
);
