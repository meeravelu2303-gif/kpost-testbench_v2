import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from '../support/session';

/**
 * Resilience: when the network or a backend call fails, the shell still renders with no uncaught error
 * or error boundary, and the app recovers when the network does. Nothing is written.
 */
const BOUNDARY = /Something went wrong/i;

test.describe(
  'KPost resilience — failing backend calls and offline',
  {
    tag: ['@ui', '@platform', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.describe.configure({ timeout: 180_000 });

    test('Katchup still renders its shell when the contacts call answers 500 @ui', async ({
      page,
    }) => {
      await skipIfSignedOut(page);
      await page.route('**/contacts/myContacts/**', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{"status":"FAILURE"}',
        }),
      );
      const stop = watchUiHealth(page);
      await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(
        page.locator('.icon-KP_04-Katchup, .Katchup_Name').first(),
        'the Katchup shell mounts',
      ).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(BOUNDARY), 'no error boundary').toHaveCount(0);
      const health = stop();
      expect(health.pageErrors, 'no uncaught error when a backend call fails').toEqual([]);
    });

    test('Home still renders its shell when the recent-messages call answers 500 @ui', async ({
      page,
    }) => {
      await skipIfSignedOut(page);
      await page.route('**/katchup/**', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: '{"status":"FAILURE"}',
            })
          : route.continue(),
      );
      const stop = watchUiHealth(page);
      await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(
        page.locator('.homeWeblasccs, .icon-KP_01-Home').first(),
        'the Home shell mounts',
      ).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(BOUNDARY), 'no error boundary').toHaveCount(0);
      expect(stop().pageErrors, 'no uncaught error when Katchup calls fail').toEqual([]);
    });

    test('going offline inside the app does not crash it, and it recovers when back online @ui', async ({
      page,
      context,
    }) => {
      await skipIfSignedOut(page);
      await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page.locator('.homeWeblasccs, .icon-KP_01-Home').first()).toBeVisible({
        timeout: 30_000,
      });
      const stop = watchUiHealth(page);
      await context.setOffline(true);
      // In-app navigation while offline: the SPA must stay up (its bundle is already loaded).
      await page
        .locator('.icon-KP_04-Katchup')
        .first()
        .click({ timeout: 10_000 })
        .catch(() => undefined);
      await expect(page.getByText(BOUNDARY), 'no error boundary while offline').toHaveCount(0);
      const offlineShell = await page
        .locator('.icon-KP_01-Home, .header_font')
        .first()
        .isVisible()
        .catch(() => false);
      expect(offlineShell, 'the app shell survives going offline').toBe(true);
      await context.setOffline(false);
      await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(
        page.locator('.icon-KP_04-Katchup, .Katchup_Name').first(),
        'Katchup renders again once the network is back',
      ).toBeVisible({ timeout: 30_000 });
      const health = stop();
      test.info().annotations.push({
        type: 'observed',
        description: `page errors across offline/online: ${JSON.stringify(health.pageErrors).slice(0, 300)}`,
      });
      expect(health.pageErrors, 'no uncaught error across the offline/online cycle').toEqual([]);
    });

    test('a slow Recents fetch shows content when it arrives (no stuck loading state, #1019) @ui', async ({
      page,
    }) => {
      await skipIfSignedOut(page);
      await page.route('**/katchup/**', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        await new Promise((r) => setTimeout(r, 6_000));
        return route.continue();
      });
      await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(
        page.locator('.recent-hover-card').first(),
        'the Recents list renders once its slow fetch answers',
      ).toBeVisible({ timeout: 45_000 });
    });
  },
);
